# Testing Patterns

**Analysis Date:** 2026-05-20

## Honest Assessment

**There is no automated test infrastructure in this repository.** Not a Jest config, not a Vitest config, not a single `*.test.ts` or `*.spec.ts` file, no `__tests__/` or `test/` directory, no CI workflow.

A search of the entire repo (excluding `node_modules/`) for `*.test.ts`, `*.spec.ts`, `__tests__`, `test/`, `tests/` returns zero results. The `package.json` `test` script is the npm init default:

```json
"test": "echo \"Error: no test specified\" && exit 1"
```

There is no `.github/workflows/` directory.

This is not a criticism of the implementation — the spec's build sequence (§10) places automated testing implicitly behind Phase 4 ("Testing & calibration, week 5"), which the codebase has not yet reached. But it must be acknowledged honestly here so downstream planners do not assume tests cover the spec-mandated invariants. **They do not.**

## The Critical Test — spec §11 (NOT YET RUN)

Spec §11 line 745 defines the cheapest end-to-end calibration test:

> `validate_idea` on the AI-native focus app idea returns NO-GO with sound reasoning

And spec §10 Phase 4 (line 732) elevates it to **the** critical test:

> Re-run Aljosa's AI-native focus app idea through the MCP. Expected output: NO-GO with specific killshot reasons. If GO, there's a bug.

**Status: ❌ NOT RUN.** No artifact, no report, no transcript of this run exists in the repository. The build has compiled and the server starts, but the calibration loop that gives the verdict math its empirical floor has not been closed.

This is the single highest-leverage test to run next — it is end-to-end, requires no test framework, and surfaces failures in the entire stack (prompt wording, tool tier assignment, fallback labelling, anti-pattern checklist enforcement) in one shot.

**Suggested procedure:**
1. Start the MCP server (`npm run build && node build/index.js` wired into Claude Desktop or Cursor).
2. Invoke `validate_idea` with: `idea = "AI-native focus app for individuals"`, `audience = "B2C"`, `builder = "solo"`.
3. Read the generated report. Expected output: **NO-GO** with at least one killshot citing crowded WTP/competitor evidence.
4. If GO or CONDITIONAL GO emerges: there is a bug — either prompt enforcement is weak, a tool is mislabelling tiers, or the fallback-degraded path is being trusted.
5. Re-run with `SERPER_API_KEY` unset to confirm graceful-degradation behaviour (expect: many `tier: D` Serper sources, `fallbacks_used` populated, `confidence_note` honest about stubs).

## Definition-of-Done Checklist (spec §11)

Status as of 2026-05-20 against spec §11 lines 740-749:

- [✅] All 5 prompts callable from Claude Desktop / Cursor / Claude Code — registered in `src/index.ts:92-96`
- [⚠️] All 6 P0 + P1 tools return data in standard shape with tier + bias flag — **only 2 of 6 new tools shipped** (`find_pricing_anchors`, `check_big_tech_encroachment`). Missing: `find_why_now_signals`, `estimate_demand_signals`, `find_public_revenue_signals`, `assess_platform_dependency`. The 6 *existing* tools are wired but were carried over from the prior weather-server scaffold; their tier/bias annotations need verification per `src/tools/find-closest-competitor.ts`.
- [✅] Paid API fallback works gracefully — pattern proven in `src/lib/serper.ts` and used by every tool that calls it (drops to free / stub + lowers confidence)
- [❌] `validate_idea` on the AI-native focus app idea returns NO-GO with sound reasoning — **not run**
- [❌] `validate_idea` on a known-good idea returns GO with sound reasoning — **not run**
- [❓] Output artifact renders cleanly when pasted into Notion — **not validated** (depends on a real validate_idea run)
- [✅] All 3 resources are accessible via MCP resource protocol — registered in `src/index.ts:51-79`, loaded fresh per invocation
- [❓] Tool call budget stays under 20 tool calls per `validate_idea` run — **not measured** (no instrumentation, no run yet)

**Summary:** 3 of 8 confirmed, 2 partial/unverified, 3 outright unmet. The two unmet end-to-end tests (AI-native focus app NO-GO, known-good idea GO) are the cheapest items to close.

## Anti-Pattern Spot Check (spec §11 lines 760-768)

These are not automated — they require human review of any generated report. A future test harness would assert each as a structural property of the `validate_idea` output:

- ❌ Producing reports without DOK layer separation
- ❌ Soft-failing tool calls (returning made-up data when the API fails)
- ❌ Skipping Contradicting Evidence search to save tool calls
- ❌ Filling in "Your Spiky POV" section automatically
- ❌ Rendering GO verdicts when validation checks have major issues
- ❌ Defaulting `unknown` bias flag to "independent" (must default to "vendor-funded")

The prompts attempt to prevent each via the embedded checklist (`src/prompts/validate-idea.ts:185-195`), and the tools attempt to prevent #2 and #6 structurally (Serper stub uses `tier: D`, `bias: unknown` — `src/lib/serper.ts:66-77`). Whether these holds in practice is exactly what the Critical Test would reveal.

## What a Future Test Layer Should Look Like

When tests are added (recommended: **vitest** — fast, native ESM, zero TS plumbing — paired with **msw** or simple `vi.spyOn(global, 'fetch')` for network mocking), they should be organized as follows.

### Test file organization (recommendation)

- Co-locate: `src/tools/find-pricing-anchors.test.ts` next to `src/tools/find-pricing-anchors.ts`.
- Mirror for libs: `src/lib/serper.test.ts`.
- Integration tests for prompts in `src/prompts/__tests__/` (snapshot-style: assert the assembled prompt text contains the spec-mandated checklist items).

### Required `package.json` script

```json
"test": "vitest run",
"test:watch": "vitest"
```

### Mocking strategy

- Mock `fetch` globally with `vi.stubGlobal('fetch', vi.fn())` per test.
- Mock `process.env['SERPER_API_KEY']` to switch between live-path and stub-path code branches.
- Never make real network calls in unit tests; reserve those for a small `tests/e2e/` suite gated behind an env flag.

### Mandatory test cases per tool — `ToolResult<T>` shape contract

Every tool must have at least these three tests, asserting the spec §7 envelope:

```ts
import { describe, it, expect } from 'vitest';
import type { ToolResult } from '../types.js';

describe('find_pricing_anchors', () => {
  it('returns a valid ToolResult<T> envelope', async () => {
    const raw = await callTool({ category: 'x', competitors: ['Forest'] });
    const result = JSON.parse(raw.content[0].text) as ToolResult<unknown>;
    expect(result).toHaveProperty('data');
    expect(Array.isArray(result.sources)).toBe(true);
    expect(typeof result.confidence_note).toBe('string');
    expect(Array.isArray(result.fallbacks_used)).toBe(true);
  });

  it('every source has URL + tier + bias + fetched_at + contribution', async () => {
    const result = await runAndParse();
    for (const s of result.sources) {
      expect(s.url).toMatch(/^https?:\/\//);
      expect(['S', 'A', 'B', 'C', 'D']).toContain(s.tier);
      expect(['independent', 'vendor-funded', 'conflicted', 'unknown']).toContain(s.bias);
      expect(() => new Date(s.fetched_at).toISOString()).not.toThrow();
      expect(s.contribution.length).toBeGreaterThan(0);
    }
  });

  it('records fallback in fallbacks_used and downgrades tier when SERPER_API_KEY missing', async () => {
    vi.stubEnv('SERPER_API_KEY', '');
    const result = await runAndParse();
    expect(result.fallbacks_used.some((f) => f.includes('serper'))).toBe(true);
    const serperSources = result.sources.filter((s) => s.url.includes('serper'));
    for (const s of serperSources) {
      expect(s.tier).toBe('D');
      expect(s.bias).toBe('unknown'); // spec §11 anti-pattern #6: never default to 'independent'
    }
  });
});
```

### Mandatory test cases per prompt — anti-pattern enforcement

```ts
describe('validate_idea prompt', () => {
  it('embeds the spec §11 anti-pattern checklist verbatim', () => {
    const { messages } = invokeValidateIdea({ idea: 'x', audience: 'B2B', builder: 'solo' });
    const text = messages[0].content.text;
    expect(text).toContain('Every DOK 1 fact has both tier badge AND bias flag');
    expect(text).toContain('Your Spiky POV');
    expect(text).toContain('BLANK');
    expect(text).toContain('unknown'); // bias-default rule must be mentioned
  });

  it('asks for audience and builder when omitted', () => {
    const { messages } = invokeValidateIdea({ idea: 'x' });
    expect(messages[0].content.text).toMatch(/Ask for both before proceeding/i);
  });
});
```

### End-to-end calibration tests (manual until automated)

These belong in `tests/e2e/` and run against a live MCP server. They cannot be unit-mocked because they're testing the model's compliance with the prompt — the very property the MCP is built to enforce. Until automated harnessing exists, they are run by hand:

| Test | Idea | Framing | Expected verdict |
|---|---|---|---|
| Critical (spec §10 P4) | "AI-native focus app for individuals" | B2C × solo | **NO-GO** |
| Known-good | (TBD — pick a historical winner) | varies | **GO** |
| Stub-only | any idea, `SERPER_API_KEY` unset | any | confidence Low, fallbacks_used populated |
| Conflicted-heavy | idea with only vendor-funded sources | any | INCONCLUSIVE (per spec §4 rule 3) |

## Run Commands

```bash
# Currently — there are no tests
npm test               # prints "Error: no test specified" and exits 1

# After adding vitest (future)
npm test               # run once
npm run test:watch     # watch mode
```

## Test Coverage Today

**Automated coverage: 0%.** The codebase compiles, but no behaviour is asserted by any check beyond `tsc --noEmit` semantics. Closing this gap should be Phase 4's first deliverable, paired with the Critical Test.

---

*Testing analysis: 2026-05-20*
