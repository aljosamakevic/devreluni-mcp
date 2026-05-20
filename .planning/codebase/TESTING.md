# Testing Patterns

**Analysis Date:** 2026-05-20
**Scope:** ProductValidation MCP server, branch `research-v2`

## Honest Assessment: No Test Infrastructure Exists

This codebase has **zero automated tests**. There is no test runner, no test files, no CI pipeline, and no fixtures. The `package.json` `test` script is the npm-init placeholder.

This is not necessarily wrong for the project's current stage — the spec (`build_spec_v1.0.md` §11) defines validation as an *end-to-end calibration test* rather than unit testing — but it should be stated plainly so that future contributors don't assume coverage where there is none.

## What's Actually Present

### Test runner: none

```json
// package.json:10-13
"scripts": {
  "test": "echo \"Error: no test specified\" && exit 1",
  "build": "tsc && chmod 755 build/index.js"
}
```

No `jest`, `vitest`, `mocha`, `ava`, or `node --test` is declared in `devDependencies`. The only dev tooling is `typescript`, `@types/node`, and `tsx`.

### Test files: none

Exhaustive search from the repo root yields no results:

```bash
find . -name "*.test.ts"        -not -path "*/node_modules/*"   # (empty)
find . -name "*.spec.ts"        -not -path "*/node_modules/*"   # (empty)
find . -name "__tests__"        -not -path "*/node_modules/*"   # (empty)
find . -name "test" -type d     -not -path "*/node_modules/*"   # (empty)
```

### Test config: none

There is no `jest.config.*`, `vitest.config.*`, `.mocharc.*`, or equivalent.

### CI: none

There is no `.github/workflows/` directory, no `.gitlab-ci.yml`, no `.circleci/`, no Travis / Buildkite configuration. No automated pipeline runs on push.

### Type-checking as the only safety net

The only automated correctness check is the TypeScript compiler invoked via `npm run build`. `tsconfig.json` enables `"strict": true`, so type errors will surface at build time — but this catches **type shape**, not runtime behaviour, network errors, or stub/live divergence.

## How Verification Happens Today (informally)

1. **Manual MCP client testing** — running the built server from Claude Desktop or another MCP host and exercising tools against real Serper / Product Hunt / HN endpoints.
2. **Graceful-degradation by construction** — every external dependency has a stub path (`src/lib/serper.ts:45-60`, `isSerperLive()` guards) and tools never throw, so a broken integration manifests as a `[STUB]`-labelled response rather than a crash.
3. **Console diagnostics on stderr only** — `console.error` is the chosen channel because stdout carries the JSON-RPC protocol. Search the logs for `[serper.ts]`, `Fatal error in main()`, etc.
4. **The spec's "Critical Test" (§11)** — re-run the AI focus app idea through the `validate_idea` prompt and assert the verdict is `NO-GO`. This is a *calibration* test of the whole gate framework, not a unit test of any single component.

## What Future Tests Should Look Like

If/when tests are introduced, the natural seams in this codebase make them straightforward. Recommended approach: **Vitest** (ESM-native, no extra config needed for the project's existing `"type": "module"` + NodeNext setup).

### 1. Tool envelope assertions (cheapest, highest value)

Every tool returns the same `ToolResult<T>` envelope (`src/types.ts:9-14`). A single helper can validate the contract across all 8 tools:

```ts
// src/tools/__tests__/envelope.test.ts (hypothetical)
import { z } from 'zod';

const ToolSourceSchema = z.object({
  url: z.string(),
  tier: z.enum(['S','A','B','C','D']),
  bias: z.enum(['independent','vendor-funded','conflicted','unknown']),
  fetched_at: z.string(),
  contribution: z.string(),
});
const ToolResultSchema = z.object({
  data: z.unknown(),
  sources: z.array(ToolSourceSchema),
  confidence_note: z.string(),
  fallbacks_used: z.array(z.string()),
});

// Then for each tool: invoke handler with sample input, parse the JSON
// content block, assert ToolResultSchema.parse(...) succeeds.
```

### 2. Mocking external HTTP calls

The lib modules wrap `fetch` directly (`src/lib/serper.ts:24-31`, `src/lib/webfetch.ts:9-17`). Two viable mocking strategies:

- **`vi.stubGlobal('fetch', ...)`** — replace global `fetch` with a Vitest mock returning canned `SerperResponse` JSON.
- **MSW (Mock Service Worker)** — intercept at the network layer; more realistic for multi-endpoint flows.

Canned shapes worth fixturing:
- `SerperResponse` with 0, 1, 5, and 10 organic results (defined `src/lib/serper.ts:10-13`)
- 4xx / 5xx HTTP responses → verify tools degrade to stubs, not throw
- Network errors (`fetch` throws) → verify `fallbacks_used` records the failure

### 3. Stub-vs-live behavioural tests

The defining invariant of this codebase is: **when an API key is missing, the tool still returns a valid `ToolResult<T>` with `fallbacks_used` populated**. This should be locked in:

```ts
// Pseudocode
delete process.env.SERPER_API_KEY;
const result = await callTool('find_closest_competitor', { idea_description: 'x' });
expect(result.fallbacks_used).toContain('serper (stub — set SERPER_API_KEY)');
expect(result.sources.some(s => s.tier === 'D')).toBe(true);
expect(() => parseToolResult(result)).not.toThrow();
```

### 4. Pure-function unit tests (no mocks needed)

The detection / scoring helpers are pure and easy to test in isolation:

- `detectFailureSignals(text)` — `src/tools/read-competitor-changelog.ts:68-76`
- `parseChangelogEntries(text, url)` — `src/tools/read-competitor-changelog.ts:78-134`
- `detectRecency(text)` — `src/tools/check-big-tech-encroachment.ts:75-83`
- `scoreAdjacency(conferences, apis, acquisitions)` — `src/tools/check-big-tech-encroachment.ts:85-112`
- `guessChangelogUrls(domain)` — `src/lib/webfetch.ts:48-58`
- `stripHtml(html)` — `src/lib/webfetch.ts:29-43`
- `cacheGet` / `cacheSet` / `makeCacheKey` — `src/lib/cache.ts`

These have no I/O, deterministic outputs, and represent the bulk of the project's heuristic logic — exactly the surface where regressions are most likely as scoring rules evolve.

### 5. Prompt structural tests

The prompt modules (`src/prompts/*.ts`) return message arrays. Useful assertions:

- The prompt text references the required resources (`resource://source-tier-bias`, `resource://tool-to-gate-map`, `resource://evaluation-lens-matrix`).
- DOK 1-4 layering instructions are present and unmodified.
- The anti-pattern checklist (`src/prompts/validate-idea.ts:185-195`) survives edits.
- Conditional branches render correctly based on `audience` / `builder` inputs.

### 6. End-to-end calibration (the spec's §11 "Critical Test")

This is **not a unit test** and should not be confused with one. It is a periodic re-run, ideally in CI on a schedule (not on every push, because Serper costs and rate limits apply):

> Re-run the AI focus app idea through the `validate_idea` prompt; expect verdict = `NO-GO` with Gate 3 failing on big-tech encroachment.

If a refactor causes that calibration to flip to `GO` or `CONDITIONAL GO`, the scoring heuristics or source weights have drifted — investigate before merging. This is the closest thing the project has to a regression test for the *framework itself*.

## Recommended Minimal First Step

If only one piece of test infrastructure is added, it should be:

1. Install `vitest` + `@vitest/coverage-v8` as dev dependencies.
2. Add `"test": "vitest run"` and `"test:watch": "vitest"` to `package.json`.
3. Write a single `envelope.test.ts` that imports each `registerXxx` function, creates an in-memory `McpServer`, lists registered tools, invokes each with minimal valid input (with `SERPER_API_KEY` unset so no external calls fire), and validates the JSON content block against the `ToolResult<T>` schema.

That single test would catch the most expensive class of regressions — envelope drift across tools — for under 100 lines of code.

## Suggested Layout (when tests arrive)

```
src/
├── tools/
│   ├── find-closest-competitor.ts
│   └── __tests__/
│       └── find-closest-competitor.test.ts
├── lib/
│   ├── serper.ts
│   └── __tests__/
│       └── serper.test.ts
└── __tests__/
    └── envelope.test.ts       # cross-tool contract test
```

Co-located `__tests__/` folders match the existing `kebab-case.ts` file naming and keep test discovery trivial.

---

*Testing analysis: 2026-05-20 — current state is "no tests"; this document is a roadmap, not a description of coverage.*
