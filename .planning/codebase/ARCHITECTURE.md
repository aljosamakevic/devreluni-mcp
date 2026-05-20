<!-- refreshed: 2026-05-20 -->
# Architecture

**Analysis Date:** 2026-05-20

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                        MCP CLIENT (Claude Desktop)                   │
│           User invokes a prompt — e.g. validate_idea(idea, ...)      │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │  JSON-RPC over stdio
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                ProductValidation MCP Server (`src/index.ts`)         │
│            McpServer instance + StdioServerTransport                 │
└──────┬────────────────────┬──────────────────────┬──────────────────┘
       │                    │                       │
       ▼                    ▼                       ▼
┌─────────────┐    ┌──────────────────┐   ┌──────────────────────┐
│  PROMPTS    │    │     TOOLS        │   │     RESOURCES        │
│ `src/prompts/`   │  `src/tools/`    │   │  `src/resources/`    │
│             │    │                  │   │                      │
│ Framework   │    │ Live data        │   │ Static markdown:     │
│ workflows;  │───▶│ fetchers;        │   │ tier/bias reference, │
│ orchestrate │    │ return           │   │ tool→gate map,       │
│ tool calls  │    │ `ToolResult<T>`  │   │ lens matrix.         │
│             │    │ with sources +   │   │ Loaded fresh on      │
│             │    │ tier + bias      │   │ each invocation      │
└─────────────┘    └────────┬─────────┘   └──────────────────────┘
                            │
                            ▼
                  ┌────────────────────┐
                  │      LIB layer     │
                  │     `src/lib/`     │
                  │  API clients +     │
                  │  cache + webfetch  │
                  └────────┬───────────┘
                           │
                           ▼
        ┌─────────────────────────────────────────┐
        │  External APIs: Serper (Google),        │
        │  Hacker News (Algolia), Product Hunt,   │
        │  Reddit (via Serper), raw web fetch     │
        └─────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Server entrypoint | Wire MCP server, register tools/prompts/resources, run stdio transport | `src/index.ts` |
| Type contracts | `ToolSource`, `ToolResult<T>` shared shape | `src/types.ts` |
| Tools (8) | Fetch live evidence, attach tier + bias + URL to every fact | `src/tools/*.ts` |
| Prompts (5) | Framework workflows that instruct the client which tools to call and how to format output | `src/prompts/*.ts` |
| Resources (3) | Static markdown reference docs loaded fresh per invocation | `src/resources/*.md` |
| Lib clients | Thin wrappers around Serper, HN Algolia, Product Hunt GraphQL, Reddit-via-Serper, raw fetch | `src/lib/*.ts` |
| Cache | In-process TTL Map shared across lib clients | `src/lib/cache.ts` |

## Pattern Overview

**Overall:** MCP three-surface server (Tools + Prompts + Resources) on top of a thin client/cache lib layer.

**Key Characteristics:**
- **Three orthogonal surfaces.** Tools are atomic, side-effect-free data fetchers. Prompts are *orchestration scripts* the LLM follows. Resources are *reference text* the LLM loads to understand grading rubrics. The three never reach into each other — the client (Claude) is the orchestrator.
- **Structural anti-confirmation-bias.** Every tool returns `ToolResult<T>` with explicit `sources[]` carrying tier `S/A/B/C/D` and bias `independent / vendor-funded / conflicted / unknown`. Prompts forbid issuing a verdict without searching for contradicting evidence and require ≥2 tier-B-or-higher sources for a PASS.
- **Fresh resource loads.** Resources are read from disk in the handler (`readFileSync` inside `loadResource`), not cached at startup — per MCP spec and so they can change between invocations without restart.
- **Graceful degradation.** Every external client returns a clearly-labelled stub when its API key is missing (e.g. `[STUB DATA — set SERPER_API_KEY]`) and downgrades its source tier from `A` to `D` so the LLM cannot mistake stubs for real data.

## Layers

**Prompts layer (`src/prompts/`):**
- Purpose: encode the Pre-Build Checklist methodology as LLM workflows; turn parameters into a long instruction string returned as a `messages[]` array.
- Location: `src/prompts/*.ts`
- Contains: one `registerX` export per prompt; uses `server.prompt()` with a Zod schema for arguments.
- Depends on: nothing in `src/` — prompts are pure text builders.
- Used by: `src/index.ts` (registration) and the MCP client at runtime.

**Tools layer (`src/tools/`):**
- Purpose: fetch and shape evidence into `ToolResult<T>` blobs the LLM can quote with citations.
- Location: `src/tools/*.ts`
- Contains: one `registerX` export per tool; uses `server.registerTool()` with a Zod input schema.
- Depends on: `src/lib/*` (clients) and `src/types.ts` (`ToolResult`, `ToolSource`).
- Used by: `src/index.ts` (registration) and the client (invoked while running a prompt).

**Resources layer (`src/resources/`):**
- Purpose: hold the grading rubrics that prompts tell the LLM to load.
- Location: `src/resources/*.md`
- Contains: pure markdown — no code.
- Loaded by: `loadResource()` in `src/index.ts`, on each `server.resource(...)` handler invocation.

**Lib layer (`src/lib/`):**
- Purpose: encapsulate external APIs behind a uniform `search* / fetch*` + `*Source()` + `is*Live()` + `*ConfidenceNote()` interface so tools don't repeat key/stub/error logic.
- Location: `src/lib/*.ts`
- Depends on: `src/types.ts` for `ToolSource`, `src/lib/cache.ts` for TTL caching, `process.env` for keys.
- Used by: every file under `src/tools/`.

## Data Flow

### Primary Request Path — `validate_idea`

1. Client calls prompt `validate_idea(idea, audience, builder)` (`src/prompts/validate-idea.ts:5`).
2. Server returns one user message containing the full Pre-Build Checklist workflow string (5 gates, DOK layering rules, fail-2 rule, output template).
3. The LLM (running on the client side) loads three resources: `resource://source-tier-bias`, `resource://tool-to-gate-map`, `resource://evaluation-lens-matrix` (`src/index.ts:51-79`).
4. The LLM walks Gates G1–G5, calling tools per-gate (e.g. for G1: `find_closest_competitor` → `read_competitor_changelog` → `map_competitive_weaknesses`).
5. Each tool fans out to lib clients (e.g. `find_closest_competitor` → `serperSearch` + `searchProductHunt` + `searchHN` in `src/tools/find-closest-competitor.ts:45-53`), assembles a `ToolResult<T>` with sources, and returns it as JSON text content.
6. The LLM lays evidence into DOK 1 (facts + tier/bias), DOK 2 (summary), DOK 3 (insights, model-judgment-tagged), DOK 4 (gate verdict), per `src/prompts/validate-idea.ts:146-163`.
7. After all 5 gates, the LLM runs three Validation Checks (source quality / counterargument / logic coherence) and applies the **Fail-2 rule**: 2+ FAILs → NO-GO, 1 FAIL or 2+ INCONCLUSIVE → CONDITIONAL GO, 0 FAIL + ≤1 INCONCLUSIVE → GO (`src/prompts/validate-idea.ts:101-106`).
8. Final artifact emitted in the 8-section Idea Validation Report format.

### Secondary Flow — `run_single_gate`

1. Client calls `run_single_gate(idea, gate, ...)` (`src/prompts/run-single-gate.ts:5`).
2. Gate identifier maps to a primary tool list (`src/prompts/run-single-gate.ts:22-48`).
3. LLM loads the same three resources, runs DOK-layered analysis for one gate only, skips the three Validation Checks.

### Secondary Flow — `quick_kill_check`

1. Client calls `quick_kill_check(idea, ...)`.
2. LLM calls at most 4 tools (`find_closest_competitor` → `read_competitor_changelog` → `find_pricing_anchors`) and scans for 4 hard kill conditions.
3. Verdict is constrained to **SUSPECTED NO-GO** or **NO OBVIOUS KILL FOUND** — GO is structurally forbidden (`src/prompts/quick-kill-check.ts:34-36`).

### Secondary Flow — `steelman_against`

1. Red-team prompt: surface only disconfirming evidence. Tools called in a fixed order: `get_category_failure_modes` → `map_competitive_weaknesses` → `find_pricing_anchors` → `find_closest_competitor` (`src/prompts/steelman-against.ts:28`).

**State Management:**
- No per-session state on the server.
- In-process TTL cache (`src/lib/cache.ts`) shared across lib calls inside a single Node process; cleared at restart.

## Key Abstractions

**`ToolResult<T>` (`src/types.ts:9`):**
- Purpose: uniform return envelope so the LLM can always rely on `.data`, `.sources[]`, `.confidence_note`, `.fallbacks_used[]` being present.
- Pattern: data + sources + confidence are co-located, making it structurally hard to surface facts without their provenance.

**`ToolSource` (`src/types.ts:1`):**
- Purpose: forces every URL the LLM will cite to also carry tier `S/A/B/C/D`, bias label, fetch timestamp, and a `contribution` string explaining what this source contributed.
- Pattern: live-vs-stub branches in lib files (e.g. `serperSource` in `src/lib/serper.ts:66`) downgrade tier+bias when keys are missing.

**Tool registration (`registerX(server)`):**
- Each tool/prompt file exports exactly one function `register<Name>(server: McpServer): void` that calls `server.registerTool(...)` or `server.prompt(...)`.
- `src/index.ts` is the single wiring point that imports and invokes every register function.

## Entry Points

**Stdio server (`src/index.ts:98`):**
- Location: `src/index.ts`
- Triggers: spawned by the MCP client (Claude Desktop) as a subprocess.
- Responsibilities: load `.env` (with `quiet: true` to avoid corrupting stdio JSON-RPC), construct `McpServer`, register 3 resources + 8 tools + 5 prompts, connect `StdioServerTransport`.

## Architectural Constraints

- **Stdio purity.** Anything written to stdout corrupts the JSON-RPC stream. Logging goes to `console.error` (stderr). `dotenv` is loaded with `quiet: true` (`src/index.ts:13-16`) because v17+ otherwise prints to stdout.
- **No persistent state.** No DB, no disk writes from tools, no per-session memory. The TTL cache in `src/lib/cache.ts` is process-local and lost on restart.
- **Stub-when-no-key, never throw.** Lib clients must return a stub on missing env vars (e.g. `getSerperStub` in `src/lib/serper.ts:45`) and downgrade source tier accordingly. Tools must list missing keys in `fallbacks_used[]`.
- **Resources must reload per invocation.** `loadResource` in `src/index.ts:41` is called inside each handler, not at module top — the comment at line 38-40 makes this explicit ("per MCP spec").

## Anti-Patterns

### Verdict without contradicting evidence

**What happens:** LLM concludes a gate PASS from one-sided evidence.
**Why it's wrong:** Defeats the "structurally impossible confirmation bias" design goal — facts alone don't validate; a search for disconfirming evidence must happen first.
**Do this instead:** Prompts force an explicit Contradicting Evidence block before DOK 4. If none found, the prompt template requires the literal string `"No contradicting evidence surfaced — treat as a gap, not confirmation."` (`src/prompts/validate-idea.ts:160`).

### Citing a fact without tier + bias

**What happens:** LLM lists a URL without `Tier: [X] | Bias: [X]`.
**Why it's wrong:** Drops the bias signal the framework is built to surface; a vendor-funded report and an independent study become indistinguishable.
**Do this instead:** Tools always emit fully-populated `ToolSource` objects; prompts mandate the format `[Fact] — Source: [URL] | Tier: [X] | Bias: [X] | Fetched: [date]` (`src/prompts/validate-idea.ts:151`).

### Treating stub data as real

**What happens:** A tool runs without its API key, returns placeholder text, and the LLM cites it as evidence.
**Why it's wrong:** Stubs are demo strings, not facts.
**Do this instead:** Lib stub paths downgrade tier to `D` and bias to `unknown` (e.g. `src/lib/serper.ts:66-77`); the prompt rule "C/D-only evidence = automatic Inconclusive" (`src/prompts/validate-idea.ts:41`) prevents stubs from validating anything.

### Issuing GO from `quick_kill_check`

**What happens:** Shallow triage gets confused with full validation.
**Why it's wrong:** quick_kill_check only looks for 4 hard kill conditions; absence of a red flag is not validation.
**Do this instead:** The prompt structurally forbids GO and constrains the verdict to SUSPECTED NO-GO or NO OBVIOUS KILL FOUND (`src/prompts/quick-kill-check.ts:34-36`).

## Error Handling

**Strategy:** Soft-fail with explicit signalling. No exceptions are propagated to the client.

**Patterns:**
- Lib clients catch fetch errors and return stubs (`src/lib/serper.ts:39-42`).
- Tools accumulate `fallbacks_used[]` and `confidence_note` strings rather than throwing.
- The `quiet: true` dotenv load (`src/index.ts:15`) protects the JSON-RPC channel from incidental stdout writes.

## Cross-Cutting Concerns

**Logging:** `console.error` only — stdout is reserved for JSON-RPC.
**Validation:** Zod schemas at the tool/prompt registration boundary; no internal re-validation.
**Caching:** In-process Map with TTL constants `SHORT` (5 min), `MEDIUM` (1 h), `LONG` (24 h) in `src/lib/cache.ts:26-30`.
**Source provenance:** Every fact carries tier + bias through the `ToolSource` shape — enforced at the type level.

---

*Architecture analysis: 2026-05-20*
