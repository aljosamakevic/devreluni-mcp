# Coding Conventions

**Analysis Date:** 2026-05-20
**Scope:** ProductValidation MCP server — TypeScript ESM, MCP SDK v1.29

## Naming Patterns

**Files:** `kebab-case.ts` matching the tool's snake_case identifier.
- `src/tools/find-closest-competitor.ts` → registers tool `find_closest_competitor`
- `src/tools/check-big-tech-encroachment.ts` → registers tool `check_big_tech_encroachment`
- `src/prompts/validate-idea.ts` → registers prompt `validate_idea`
- `src/lib/serper.ts`, `src/lib/webfetch.ts` — single-word lib modules stay flat
- `src/resources/source-tier-bias.md` — markdown resources also kebab-case

**Tool / Prompt identifiers (MCP wire names):** `snake_case`.
- `find_closest_competitor`, `read_competitor_changelog`, `validate_idea`

**Exported register functions:** `registerPascalCase`, matching the tool name.
- `registerFindClosestCompetitor`, `registerReadCompetitorChangelog`, `registerCheckBigTechEncroachment`
- Prompts follow the same rule with `Prompt` suffix: `registerValidateIdeaPrompt`, `registerQuickKillCheckPrompt`

**Types & interfaces:** `PascalCase`.
- `ToolResult<T>`, `ToolSource`, `SerperResponse`, `FailureSignal`, `AdjacencyScore`
- Tool-local data types end in `Data` and are used as the `T` in `ToolResult<T>`:
  `FindClosestCompetitorData`, `CheckBigTechEncroachmentData`, `ReadCompetitorChangelogData`

**Local variables / functions:** `camelCase`.
- `fallbacksUsed`, `resolvedUrl`, `serperSearch`, `detectFailureSignals`, `scoreAdjacency`

**Constants:** `SCREAMING_SNAKE_CASE` for module-level immutables.
- `FAILURE_PATTERNS`, `HYPERSCALER_CONFERENCES`, `RECENT_YEARS`, `SERPER_BASE`, `TTL`

## Module Style — ESM + Node strict resolution

**`tsconfig.json`:** `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"target": "ES2022"`, `"strict": true`.
**`package.json`:** `"type": "module"`.

**`.js` extensions are mandatory in relative imports** — TypeScript source imports the compiled output path:

```ts
import type { ToolResult, ToolSource } from '../types.js';
import { serperSearch, isSerperLive } from '../lib/serper.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
```

The SDK is also imported with `.js` suffixes (`@modelcontextprotocol/sdk/server/mcp.js`, `.../stdio.js`) because the published SDK is itself ESM with explicit extensions.

**Type-only imports** use `import type { ... }` — see every tool file.

## Tool Registration Pattern

Every tool module exports exactly one function `registerXxx(server: McpServer): void` that calls `server.registerTool(name, schema, handler)`. The function is imported and invoked from `src/index.ts`.

Skeleton (consistent across all 8 tools):

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult, ToolSource } from '../types.js';

interface XxxData { /* tool-specific payload */ }

export function registerXxx(server: McpServer): void {
  server.registerTool(
    'xxx_tool_name',                       // snake_case wire name
    {
      description: '...',                  // one paragraph, plain language
      inputSchema: {                       // zod shape, NOT z.object(...)
        idea_description: z.string().describe('...'),
      },
    },
    async ({ idea_description }) => {
      const fallbacksUsed: string[] = [];
      const sources: ToolSource[] = [];
      // ... fetch, transform, score ...
      const result: ToolResult<XxxData> = {
        data,
        sources,
        confidence_note: '...',
        fallbacks_used: fallbacksUsed,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
```

**Wiring:** Add the import + call in `src/index.ts` after the existing block (`src/index.ts:19-26` for imports, `src/index.ts:82-89` for calls). Prompts mirror the same pattern (`src/index.ts:29-33`, `92-96`).

## The `ToolResult<T>` Envelope

Defined in `src/types.ts`. Every tool — without exception — returns this shape serialized as JSON inside an MCP text content block.

```ts
export interface ToolSource {
  url: string;
  tier: 'S' | 'A' | 'B' | 'C' | 'D';
  bias: 'independent' | 'vendor-funded' | 'conflicted' | 'unknown';
  fetched_at: string;        // ISO 8601 — always `new Date().toISOString()`
  contribution: string;       // human-readable: what this source contributed
}

export interface ToolResult<T> {
  data: T;                    // tool-specific payload
  sources: ToolSource[];      // every external lookup yields a source
  confidence_note: string;    // one paragraph: how trustworthy is `data`?
  fallbacks_used: string[];   // strings naming each degradation that fired
}
```

**Return shape from the handler:**
```ts
return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
```
Always `JSON.stringify(result, null, 2)` — pretty-printed, single text block.

## Source Tiering & Bias

Defined as the union types in `src/types.ts`; rationale documented in `src/resources/source-tier-bias.md` (loaded fresh per MCP request, see `src/index.ts:51-79`).

**Tier (epistemic strength):**
- `S` — primary / immutable (first-party docs, keynotes, archived pages, fetched competitor changelog)
- `A` — strong secondary (press of record, Serper live results)
- `B` — useful secondary (snippets, aggregator pages)
- `C` — weak / indirect
- `D` — placeholder / stub (used when an API key is missing)

**Bias flag:**
- `independent` — third party with no commercial stake
- `vendor-funded` — analyst paid by the vendor
- `conflicted` — first-party self-reporting (competitor's own changelog, hyperscaler's own keynote)
- `unknown` — stubs, search facades

**Convention:** when serper is live the source becomes tier `A` / `independent`; when stubbed it downgrades to tier `D` / `unknown`. See `src/lib/serper.ts:62-77` for the canonical `serperSource()` helper.

## Graceful Degradation — never throw, always degrade

Every external dependency has an `isXxxLive()` check and a stub path. Tools must:

1. Call `isXxxLive()` before or after the fetch.
2. If not live, push a human-readable string into `fallbacks_used`:
   `fallbacksUsed.push('serper (stub — set SERPER_API_KEY)');`
3. Continue executing with stub data — the tool still returns a valid `ToolResult<T>`.
4. Wrap network calls in `try { ... } catch { /* graceful degradation */ }` (see `src/tools/check-big-tech-encroachment.ts:147-153, 208-211, 249-251`).
5. Never `throw` from a tool handler. Errors become `fallbacks_used` entries or downgraded source tiers.

Canonical example — Serper:

```ts
// src/lib/serper.ts:17-43
export async function serperSearch(query: string, num = 10) {
  const apiKey = process.env['SERPER_API_KEY'];
  if (!apiKey) return getSerperStub(query);
  try {
    const response = await fetch(SERPER_BASE, { ... });
    if (!response.ok) throw new Error(`Serper returned ${response.status}`);
    return (await response.json() as SerperResponse).organic ?? [];
  } catch (err) {
    console.error('[serper.ts] serperSearch error:', err);
    return getSerperStub(query);   // degrade, do not throw
  }
}
```

Stub data is always **labelled** — titles and snippets are prefixed with `[STUB]` / `[STUB DATA — set SERPER_API_KEY for live results]` so the calling LLM cannot mistake it for real evidence (`src/lib/serper.ts:45-60`).

## Zod for Input Schemas

- Use `zod` for every tool's `inputSchema`.
- Pass the **shape object directly** (not `z.object({...})`); the MCP SDK wraps it.
- Always call `.describe('...')` on each field — the description is what the LLM sees when choosing arguments.
- Use enums to constrain free-text where possible (see `src/prompts/validate-idea.ts:9-16`: `z.enum(['B2B', 'B2C', 'B2B2C', 'dev_tools'])`).
- Mark optional inputs with `.optional()` and document the fallback in the description.

```ts
inputSchema: {
  idea_description: z.string().describe('Plain-language description of the product idea'),
  category: z.string().describe('Product category — e.g. "focus app"'),
  category_keywords: z.array(z.string()).optional().describe('Optional extra keywords'),
}
```

## DOK Layering (DOK 1-4) — a prompt-side convention

The Depth-of-Knowledge layering is **enforced by the prompts**, not the tools. Tools emit raw facts; prompts force the assistant to organise them:

- **DOK 1 — Facts** — every claim must carry `[Tier S/A/B/C/D] | [bias]` plus URL + fetch date.
- **DOK 2 — Summary** — plain restatement, no interpretation.
- **DOK 3 — Insights** — explicitly labelled `⚠️ Model judgment:`.
- **DOK 4 — Verdict** — PASS / FAIL / INCONCLUSIVE only after contradicting-evidence search.

See `src/prompts/validate-idea.ts:33-46` for the operating rules and `src/prompts/validate-idea.ts:55-65` for the per-gate workflow. New prompts must keep DOK separation strict; tools must keep providing the tier+bias metadata that DOK 1 depends on.

## Comments & Inline Rationale

Two distinct comment styles are used. Apply the right one to the right surface.

**1. File-header rationale block** — for tools whose role in the gate framework or scoring heuristic needs explanation. Plain `//` lines at top of file, no JSDoc. Example, `src/tools/check-big-tech-encroachment.ts:1-9`:

```ts
// check_big_tech_encroachment — Gate 3 (Platform/Moat Risk) primary tool, Gate 5 secondary.
//
// Surfaces evidence that Apple / Google / Microsoft might ship a feature
// that obsoletes the user's idea — by scanning their dev conferences,
// public API/SDK releases, and acquisition history in the category.
//
// Per spec: returns adjacency score (1-5) where 5 = hyperscaler is already
// shipping something in this space. Source tiers: S (dev docs, keynotes),
// A (acquisition news).
```

**2. Section banners + inline why** — break long handlers into phases with horizontal-rule banners, and explain *why* a constant or filter exists (not what it does):

```ts
// Conferences are the highest-signal place to find "what hyperscalers
// will ship in the next 12-24mo". The official site:domain filters keep
// us anchored to first-party material (tier S).
const HYPERSCALER_CONFERENCES = [ ... ];

// ───────────────────────────────────────────────────────────
// Phase 1: Conference mentions across all hyperscalers
// ───────────────────────────────────────────────────────────
```

**3. JSDoc** — sparingly, only on exported helpers whose contract is non-obvious. See `src/index.ts:37-43` (`loadResource`) — explains the spec requirement to load resources fresh per request, not at startup.

**4. `dotenv` quirk** — critical inline comment at `src/index.ts:9-16` documents why `quiet: true` matters (stdout pollution corrupts JSON-RPC over stdio). Pattern: surface non-obvious operational gotchas right above the code that handles them.

**Anti-pattern:** do not comment what the code already says. Comment the *why*, the *spec rule*, or the *failure mode being prevented*.

## Resource Loading (fresh per invocation)

Resources are markdown files in `src/resources/` and are read from disk inside the resource handler — never cached at module import time. See `src/index.ts:37-79`. New resources follow the same pattern: add the `.md` file, register with `server.resource(name, uri, async () => ({ contents: [...] }))`.

## Cache Helper

`src/lib/cache.ts` provides a tiny in-process TTL map (`cacheGet`, `cacheSet`, `makeCacheKey`, `TTL.SHORT/MEDIUM/LONG`). Use it for repeat lookups within a session; do not assume persistence across server restarts.

## Environment Variables

- Loaded once in `src/index.ts:13-16` via `dotenv` with `quiet: true` from a path relative to the compiled `build/` directory.
- Access via bracket syntax `process.env['SERPER_API_KEY']` (required by `noPropertyAccessFromIndexSignature` semantics under strict mode).
- Every key has a fallback path; missing keys are not fatal.
- Documented in `.env.example`; never commit `.env`.

## Error Handling Summary

| Surface | Convention |
|---------|-----------|
| External fetch | `try/catch` → return stub / empty array, log to `console.error` |
| Missing API key | `isXxxLive()` returns false → push to `fallbacks_used`, use stub |
| Tool handler | Must always return a valid `ToolResult<T>`; never throw |
| Fatal startup error | `main().catch(...)` → `console.error` + `process.exit(1)` (`src/index.ts:109-112`) |
| All logging | `console.error` only — `console.log` is reserved for the JSON-RPC channel on stdio |

## File Layout Recap

```
src/
├── index.ts            # entrypoint, dotenv, server bootstrap, registrations
├── types.ts            # ToolResult<T>, ToolSource — shared envelope
├── lib/                # external clients (serper, hn, producthunt, reddit, webfetch, cache)
├── tools/              # one file per MCP tool, exports registerXxx()
├── prompts/            # one file per MCP prompt, exports registerXxxPrompt()
└── resources/          # markdown loaded fresh per request
```

---

*Convention analysis: 2026-05-20*
