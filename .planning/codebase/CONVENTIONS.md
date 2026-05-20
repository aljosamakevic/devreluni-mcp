# Coding Conventions

**Analysis Date:** 2026-05-20

Conventions in this codebase split into two groups:

1. **Spec-mandated conventions** — encoded in `.planning/spec/build-spec-v1.0.md` (v1.0). Deviation breaks the core IP of the MCP (structural anti-confirmation-bias). These MUST be preserved.
2. **Implementation conventions** — chosen by the engineering agent for ergonomics. Internally consistent; safe to evolve as long as consistency is preserved.

Every convention below cites either a spec section or marks itself "implementation convention."

## Naming Patterns

**Files (implementation convention):**
- `kebab-case.ts` for all source files.
  - Tools: `src/tools/find-pricing-anchors.ts`, `src/tools/check-big-tech-encroachment.ts`
  - Prompts: `src/prompts/validate-idea.ts`, `src/prompts/quick-kill-check.ts`
  - Libs: `src/lib/serper.ts`, `src/lib/producthunt.ts`
  - Resources (markdown): `src/resources/source-tier-bias.md`, `src/resources/evaluation-lens-matrix.md`

**Tool names registered with MCP (spec §7 + §6):**
- `snake_case` matching the spec's tool list verbatim. Example: `find_pricing_anchors`, `check_big_tech_encroachment`, `read_competitor_changelog`. These names are part of the public contract — prompts in §6 call tools by exactly these identifiers.

**Exported functions (implementation convention):**
- `camelCase` for plain functions: `serperSearch`, `fetchPage`, `stripHtml`, `isSerperLive`, `cacheGet`.
- `PascalCase` prefix `register*` for the tool/prompt registration entry-points: `registerFindPricingAnchors`, `registerValidateIdeaPrompt`. One `register*` function per file.

**Types & interfaces (implementation convention):**
- `PascalCase`: `ToolResult<T>`, `ToolSource`, `SerperOrganicResult`, `CurrentPricing`.
- Generic envelope in `src/types.ts` — see "Standard `ToolResult<T>` Envelope" below.

**Resource URIs (MCP convention):**
- `resource://<kebab-name>` matching the file stem: `resource://source-tier-bias`, `resource://tool-to-gate-map`, `resource://evaluation-lens-matrix` (see `src/index.ts:51-79`).

## Tool Registration Pattern (implementation convention)

Every tool file exports a single `registerXxx(server: McpServer): void` function called from `src/index.ts`. Inside, it calls `server.registerTool(name, { description, inputSchema }, async handler)`. Pattern visible in `src/tools/find-pricing-anchors.ts:99-119`.

```ts
export function registerFindPricingAnchors(server: McpServer): void {
  server.registerTool(
    'find_pricing_anchors',
    {
      description: '...',
      inputSchema: { /* zod object */ },
    },
    async ({ category, competitors, framing }) => { /* ... */ }
  );
}
```

Prompts follow the same shape with `server.prompt(name, schema, handler)` — see `src/prompts/validate-idea.ts:5-18`.

## Standard `ToolResult<T>` Envelope (spec §7 — MANDATORY)

Defined in `src/types.ts`:

```ts
export interface ToolResult<T> {
  data: T;
  sources: ToolSource[];
  confidence_note: string;
  fallbacks_used: string[];
}

export interface ToolSource {
  url: string;
  tier: 'S' | 'A' | 'B' | 'C' | 'D';
  bias: 'independent' | 'vendor-funded' | 'conflicted' | 'unknown';
  fetched_at: string;
  contribution: string;
}
```

Spec §7 (lines 484-499) defines this exact shape. Every tool returns:

```ts
return {
  content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
};
```

where `result` is a `ToolResult<T>`. Verified in `src/tools/find-pricing-anchors.ts:293-310`.

**Why this matters (spec §4 runtime requirement, lines 202-208):** Every fact entered into a DOK 1 layer must have URL + tier + bias + `fetched_at`. The envelope makes those fields impossible to omit at the tool boundary — so the prompt layer cannot fabricate or strip them.

## Graceful Degradation — "Never Fail Silently" (spec §7 line 501 — MANDATORY)

Pattern in `src/lib/serper.ts`:

- `isSerperLive(): boolean` — checks `process.env['SERPER_API_KEY']`.
- `serperSearch(query, num)` — if no key OR fetch throws, returns `getSerperStub(query)` with clearly-labeled `[STUB]` snippets pointing to `example.com`.
- `serperSource(query)` — when stubbed, returns the source tagged `tier: 'D'`, `bias: 'unknown'` instead of `A`/`independent`. Live data is tagged `A`/`independent`.
- `serperConfidenceNote()` — emits `'Set SERPER_API_KEY for live search data. Results are stubbed.'` when degraded.

Inside each tool, the degradation is recorded:

```ts
if (!isSerperLive()) fallbacksUsed.push('serper (stub — set SERPER_API_KEY)');
```

(see `src/tools/find-pricing-anchors.ts:126`, `src/tools/find-closest-competitor.ts:46-50`).

**Spec rationale:** Anti-pattern #2 in §11 ("Soft-failing tool calls — returning made-up data when the API fails") is rejected by this pattern — stubs are visibly stubbed, downgraded in tier, and listed in `fallbacks_used`.

**Convention for new external-API libs:** mirror Serper's quartet — `isXxxLive()` / `xxxSearch()` / `xxxSource()` / `xxxConfidenceNote()`. Examples already in `src/lib/producthunt.ts` (`isPHLive`, `phSource`, `phConfidenceNote`).

## Source Tier Assignment (spec §4 — MANDATORY)

Tier values `S | A | B | C | D` are assigned **at the tool layer, not the prompt layer** (spec Appendix B, note 3). Mapping observed in code:

| Source | Tier | Bias | Where assigned |
|---|---|---|---|
| Live competitor pricing page | S | conflicted | `src/tools/find-pricing-anchors.ts:140-148` |
| Wayback Machine snapshot | S | independent | `src/tools/find-pricing-anchors.ts:152-159` |
| Serper (live key) | A | independent | `src/lib/serper.ts:66-77` |
| Serper (stubbed, no key) | D | unknown | `src/lib/serper.ts:66-77` |
| G2 / Capterra aggregates | B | independent | `src/tools/find-pricing-anchors.ts:191-197` |

Spec §4 lines 173-200 is the authoritative tier definition. New tools must consult it before assigning a tier; default to a **lower** tier when uncertain (spec §4 line 208: "Default to more cautious labels when uncertain").

## Bias Flag Assignment (spec §4 — MANDATORY)

Values: `independent | vendor-funded | conflicted | unknown`.

**Critical rule (spec §4 rule 4, line 197 + spec §11 anti-pattern #6, line 767):**

> `unknown` = treat as `vendor-funded` for confidence math
> ❌ Defaulting `unknown` bias flag to "independent" (must default to "vendor-funded")

This rule lives at both layers:
- **Tool layer:** prefer `unknown` over guessing `independent` when an unauthenticated/stubbed call cannot determine bias. Serper stub uses `unknown`, not `independent` — see `src/lib/serper.ts:71`.
- **Prompt layer:** the model performs confidence math treating `unknown` as `vendor-funded` (encoded in `src/prompts/validate-idea.ts:34` operating rule 1 + the anti-pattern checklist at lines 185-195).

Bias selection in practice:
- A competitor's own site → `conflicted` (they have a direct stake; spec §4 rule 6).
- Wayback / SEC / GitHub commits → `independent`.
- Gartner / Forrester / vendor whitepapers → `vendor-funded`.
- Anything you can't classify → `unknown` (prompt-side math will treat as `vendor-funded`).

## DOK 1→4 Layering in Prompts (spec §5 + §6.1 — MANDATORY)

Prompts must instruct the model to produce 4 strictly-separated layers per gate:

- **DOK 1 — Facts** (raw, sourced with tier+bias+URL+fetched_at)
- **DOK 2 — Summary** (plain restatement, no interpretation)
- **DOK 3 — Insights** (explicitly labeled "⚠️ Model judgment")
- **DOK 4 — Verdict** (Pass/Fail/Inconclusive)

Encoded in `src/prompts/validate-idea.ts:33-46` (operating rules) and `:57-65` (per-gate workflow), matching spec §6.1 lines 346-355.

**Convention for new prompts:** if they involve gate analysis they MUST include the same DOK separation. `run-single-gate.ts` and `steelman-against.ts` follow this. `quick_kill_check` explicitly skips DOK layering per spec §6.5 line 470 — that skip is itself a spec-mandated exception, not freedom.

## Anti-Pattern Checklist Embedded in Prompts (spec §11 — MANDATORY)

Each gate-bearing prompt ends with an explicit checklist enforcing spec §11 anti-patterns (lines 760-768). See `src/prompts/validate-idea.ts:185-195`:

```
[ ] Every DOK 1 fact has both tier badge AND bias flag
[ ] DOK 3 insights are visibly labeled as ⚠️ model judgment
[ ] Every gate has contradicting evidence (or explicit "none found")
[ ] No D-tier source used to validate (only flag concerns)
...
[ ] "Your Spiky POV" is present but BLANK
```

This list maps 1:1 to spec §6.1 lines 390-400 and §11 anti-patterns. Keep them synced — when the spec adds an anti-pattern, the prompt checklist must mirror it.

## "Your Spiky POV" Stays Blank (spec §5 + Appendix B note 4 — MANDATORY)

`src/prompts/validate-idea.ts:119-121` and `:171-172` instruct: *"Leave this section completely blank. User fills it in."* This is not a TODO — it is the spec's deliberate design (Appendix B, lines 843-844). Do not "helpfully" prefill it in a future change.

## Zod for Input Validation (implementation convention)

Tool/prompt input schemas use `zod` (v3.25.x) `z.object({...})`-shaped definitions passed to `server.registerTool` / `server.prompt`. Every field has `.describe(...)`. Examples:

- `src/prompts/validate-idea.ts:7-17`
- `src/tools/find-pricing-anchors.ts:106-117`

`zod` is the only runtime validation library. Don't introduce alternatives.

## ESM with `.js` Import Suffixes (Node ESM strict resolution)

`package.json` declares `"type": "module"` and `tsconfig.json` uses `"module": "NodeNext"`. Local imports therefore include the `.js` extension even though the source is `.ts`:

```ts
import { fetchPage, stripHtml } from '../lib/webfetch.js';
import type { ToolResult, ToolSource } from '../types.js';
import { registerFindClosestCompetitor } from './tools/find-closest-competitor.js';
```

This is a Node ESM resolver requirement, not stylistic. The TypeScript compiler resolves the `.js` to the `.ts` source at build time and emits the same `.js` import path. All new files must follow this.

## Comment Style — Inline Rationale (implementation convention)

Comments explain *why*, not *what*. Where a non-obvious behaviour exists, it carries a short comment citing the constraint. Examples:

- `src/index.ts:9-16` — explains why `dotenv` is loaded with `quiet: true` (stdout corruption of the JSON-RPC channel).
- `src/index.ts:37-43` — `loadResource` is fresh-per-invocation, citing the MCP spec / Appendix B note 1.

Pattern to follow: when a line exists for spec compliance, cite the spec section in a one-line comment.

## Module Design

- One concern per file. Tools live in `src/tools/`, prompts in `src/prompts/`, shared HTTP/search clients in `src/lib/`, types in `src/types.ts`.
- Default to named exports. The only side-effecting file is `src/index.ts` (server bootstrap).
- No barrel (`index.ts` re-export) files inside subfolders — each call site imports directly from the leaf module.

## Function Design

- Tool handlers are async, destructure their validated input, and return the standard MCP `{ content: [{ type: 'text', text: ... }] }` shape with a JSON-stringified `ToolResult<T>` inside.
- Helpers (`detectPricingModel`, `extractPriceTiers`, `extractChurnLanguage` in `src/tools/find-pricing-anchors.ts:53-97`) are pure, synchronous, and live in the same file as their single caller until reused.
- Regex-heavy parsing logic is split into named helpers rather than inlined — improves readability and unit-testability when tests are added.

## Logging

- All diagnostic output goes to `console.error` (stderr) — never `console.log`. Reason: stdout is the JSON-RPC channel for the MCP stdio transport. See `src/index.ts:101-106` and `src/lib/serper.ts:40`.

## Error Handling

- External HTTP calls are wrapped in `try/catch` and fall back to stub data on failure (e.g., `src/lib/serper.ts:23-43`). Errors are logged to stderr and a `[STUB]` result is returned so the tool envelope is never broken.
- Inside tool handlers, partial failure is recorded in `fallbacks_used[]` and `confidence_note`, not thrown. This implements spec §7's "Never fail silently" requirement while still always returning a valid `ToolResult<T>`.

## Configuration

- Secrets via `.env` at the package root, loaded with `dotenv` (`quiet: true` mandatory — see comment above).
- Env vars referenced via `process.env['KEY_NAME']` (bracket form preserves TS strict-mode safety).
- Known keys: `SERPER_API_KEY`, `PRODUCTHUNT_API_KEY`. Absence is graceful, not fatal.

## Caching

- In-memory `Map`-based cache in `src/lib/cache.ts` with TTL constants `SHORT` / `MEDIUM` / `LONG`. Used inside tool runs for repeated lookups.
- Per spec Appendix B note 1: caching tool *results* within a single workflow run is allowed; caching *resource files* at startup is forbidden — they must be re-read per invocation (enforced by `loadResource()` in `src/index.ts:41-43`).

## Linting / Formatting

- No ESLint or Prettier config present in the repo. TypeScript `strict: true` in `tsconfig.json` is the only enforced check.
- Consistency is maintained by convention, not tooling. A future addition of ESLint + Prettier would not change any of the spec-mandated conventions above — it would only formalize the implementation conventions.

---

*Convention analysis: 2026-05-20*
