<!-- refreshed: 2026-05-20 -->
# Architecture

**Analysis Date:** 2026-05-20

## System Overview

Per spec §2, this is an MCP (Model Context Protocol) server that orchestrates an unbiased, source-grounded product idea validation across 5 structured gates. The user invokes a prompt inside their AI assistant (Claude Desktop, Cursor, Claude Code), the prompt orchestrates tool calls that fetch live signal with tier+bias labels, and the model assembles a DOK-layered Idea Validation Report.

```text
┌─────────────────────────────────────────────────────────────┐
│  USER (Claude Desktop / Cursor / Claude Code over stdio)    │
│  invokes an MCP prompt with an idea + framing               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  PROMPTS — 5 user-facing workflows                          │
│  `src/prompts/validate-idea.ts`     (master, 5-gate report) │
│  `src/prompts/quick-kill-check.ts`  (60-sec triage)         │
│  `src/prompts/steelman-against.ts`  (red-team)              │
│  `src/prompts/run-single-gate.ts`   (one gate deep dive)    │
│  `src/prompts/generate-test-cards.ts` (hypotheses)          │
└──────────────────────┬──────────────────────────────────────┘
                       │ orchestrate (LLM-driven, sequential per gate)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  TOOLS — live-signal fetchers (return ToolResult<T>)        │
│  `src/tools/*.ts` — 8 built, 4 remaining                    │
│  All return `{ data, sources[], confidence_note,            │
│                fallbacks_used[] }` per `src/types.ts`       │
└──────────────────────┬──────────────────────────────────────┘
                       │ use
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  LIB — shared infrastructure (HTTP, search, cache)          │
│  `src/lib/serper.ts`       Google search (Serper API)       │
│  `src/lib/reddit.ts`       Reddit signals via Serper        │
│  `src/lib/hn.ts`           Hacker News (Algolia API)        │
│  `src/lib/producthunt.ts`  Product Hunt search              │
│  `src/lib/webfetch.ts`     Raw HTTP fetch + HTML strip      │
│  `src/lib/cache.ts`        In-memory TTL cache              │
└──────────────────────┬──────────────────────────────────────┘
                       │ reference (loaded fresh per invocation)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  RESOURCES — 3 static markdown docs                         │
│  `src/resources/source-tier-bias.md`                        │
│  `src/resources/tool-to-gate-map.md`                        │
│  `src/resources/evaluation-lens-matrix.md`                  │
└──────────────────────┬──────────────────────────────────────┘
                       │ produce
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  OUTPUT: Idea Validation Report (markdown, DOK-layered)     │
│  Verdict + 5 gate blocks + 3 validation checks +            │
│  test cards + BLANK Spiky POV + source appendix             │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| MCP server bootstrap | Load `.env`, create `McpServer`, register resources/tools/prompts, connect stdio transport | `src/index.ts` |
| Tool result contract | Standard `{ data, sources, confidence_note, fallbacks_used }` shape with `ToolSource` carrying url/tier/bias/fetched_at/contribution | `src/types.ts` |
| Search infrastructure | Serper-backed Google search with graceful stub fallback when `SERPER_API_KEY` absent | `src/lib/serper.ts` |
| Reddit signals | Reddit search via Serper site-restricted queries | `src/lib/reddit.ts` |
| HN signals | Algolia HN Search API client | `src/lib/hn.ts` |
| Product Hunt signals | PH GraphQL / search client | `src/lib/producthunt.ts` |
| Raw web fetch | Pricing-page and changelog scraping with HTML strip | `src/lib/webfetch.ts` |
| In-memory cache | TTL-keyed cache (SHORT 5m / MEDIUM 1h / LONG 24h) used by tools to avoid re-fetching within a workflow run | `src/lib/cache.ts` |
| MCP prompts | User-invoked workflow templates that emit instructions for the model | `src/prompts/*.ts` |
| MCP tools | Live-data fetchers that attach tier+bias at the data layer | `src/tools/*.ts` |
| Static resources | Tier/bias reference, tool-to-gate map, framing-conditional evaluation lens — re-read by the model per invocation | `src/resources/*.md` |

## Pattern Overview

**Overall:** Three-primitive MCP server (Prompts + Tools + Resources) with a thin layered architecture: prompts orchestrate tools, tools use shared lib clients, all data carries provenance.

**Key Characteristics:**
- **LLM is the orchestrator.** Prompts emit instructions; the model decides tool call order per gate (per spec §6.1 workflow). No JS-side state machine.
- **Provenance at the data layer, not the prompt layer.** Per Appendix B(3), tier and bias are assigned inside tools (`src/types.ts` `ToolSource`), never fabricated by prompts.
- **Graceful degradation.** Every external API check `isSerperLive() / isPHLive()` and returns stub data + lowered `confidence_note` when keys absent (per spec §7 contract).
- **Stateless stdio transport.** No persistent server state across invocations; cache is in-process only.

## Layers

**Server bootstrap (`src/index.ts`):**
- Purpose: wire dotenv → MCP server → register all primitives → connect stdio
- Depends on: every tool/prompt/resource module
- Used by: the `weather` bin entry (`build/index.js`) launched by the AI assistant

**Prompt layer (`src/prompts/*.ts`):**
- Purpose: define 5 workflow templates (zod-typed args → string instructions)
- Pattern: each file exports `registerXyzPrompt(server)`; calls `server.prompt(name, schema, factory)`
- Depends on: nothing at runtime (pure text generation)
- Used by: `src/index.ts`

**Tool layer (`src/tools/*.ts`):**
- Purpose: fetch live signal, label provenance, return `ToolResult<T>`
- Pattern: each file exports `registerXyz(server)`; calls `server.registerTool(name, {description, inputSchema}, handler)`
- Depends on: `src/lib/*` for external IO, `src/types.ts` for result shape
- Used by: `src/index.ts` (registration) and the LLM (invocation at runtime)

**Library layer (`src/lib/*.ts`):**
- Purpose: encapsulate external API clients, fetch helpers, and the in-memory cache
- Depends on: `process.env` for API keys, `fetch` (Node 18+ global)
- Used by: tool layer

**Resource layer (`src/resources/*.md`):**
- Purpose: framing-conditional reference docs the model re-reads per workflow
- Loaded by: `loadResource()` in `src/index.ts` — fresh per request (not at import time) per Appendix B(1)

## Data Flow

### Primary Request Path (`validate_idea`)

1. User invokes `validate_idea` prompt with `{ idea, audience?, builder? }` (`src/prompts/validate-idea.ts:5`)
2. MCP returns prompt text containing OPERATING RULES, RESOURCES TO LOAD, WORKFLOW steps
3. Model reads the 3 resources (`resource://source-tier-bias`, `resource://tool-to-gate-map`, `resource://evaluation-lens-matrix`) — served fresh by callbacks in `src/index.ts:51-79`
4. For each of Gates 1–5: model selects tools from Tool-to-Gate Map, calls them
5. Each tool (e.g. `src/tools/find-closest-competitor.ts`) calls lib clients (Serper, HN, PH), assembles `ToolResult<T>` with per-source tier+bias
6. Model writes DOK 1 (sourced facts) → DOK 2 (summary) → DOK 3 (insights, labeled ⚠️) → searches contradicting evidence → DOK 4 (verdict)
7. Model runs the 3 Validation Checks (Source Quality / Counterargument / Logic & Coherence)
8. Model applies fail-2 verdict math, then Validation Check overrides (per spec §3)
9. Model emits final Idea Validation Report markdown with BLANK Spiky POV section

### Secondary Flows

- **`quick_kill_check`**: budget ≤4 tool calls — `find_closest_competitor`, `read_competitor_changelog` (top 1), `check_big_tech_encroachment`, `find_pricing_anchors` (top 2). Never issues GO.
- **`steelman_against`**: skips 5-gate structure, fires only disconfirming tools (`get_category_failure_modes`, `map_competitive_weaknesses`, `check_big_tech_encroachment`, `assess_platform_dependency` once built).
- **`run_single_gate`**: runs one gate; does NOT run the 3 Validation Checks (spec §6.3).
- **`generate_test_cards`**: pure hypothesis generation in Strategyzer Test Card format; no tools required.

**State Management:**
- No persistent state. Stdio transport is request/response only.
- In-process cache (`src/lib/cache.ts`) is the only mutable state; lives for the lifetime of the spawned MCP process.

## The 5 Gates

Per spec §3, the Pre-Build Checklist. Fail-2 rule: 2+ failed gates = NO-GO.

| # | Name | Question |
|---|------|----------|
| **G1** | Direct Competitor Scan | Who's the closest existing thing, what have they shipped, where are they weak? |
| **G2** | Market Structure | Is the market shaped such that this idea can win meaningful share? (solo: niche reachability ~1k customers; funded: plausibly $1B+ TAM) |
| **G3** | Platform & Big-Tech Risk | Will a platform change or hyperscaler shipping this as a system primitive kill it in 24 months? |
| **G4** | Willingness to Pay | Will the target customer actually pay enough? (auto-flag: comp prices dropped >25% over 24mo; all-free category) |
| **G5** | Why Now | What changed in last 24mo making this possible/necessary NOW? (auto-Inconclusive if no non-obvious why-now) |

### Verdict math (per spec §3)

| Gate verdicts | Overall |
|---|---|
| 0 fails, ≤1 inconclusive | **GO** |
| 1 fail OR 2+ inconclusive | **CONDITIONAL GO** |
| 2+ fails | **NO-GO** |

Validation Checks (in `validate_idea` only) can override:
- Major issues → downgrade overall confidence to Low
- Fundamental flaws → override verdict to "Inconclusive — re-run with better sources"

PASS additionally requires ≥2 tier-B-or-higher sources; C/D-only = automatic Inconclusive; if >30% deciding-tier sources are `conflicted`, confidence is downgraded one level.

## The 5 Prompts

Per spec §6. All implemented.

| Prompt | File | One-line purpose |
|--------|------|------------------|
| `validate_idea` | `src/prompts/validate-idea.ts` | Master workflow — 5 gates, DOK layering, 3 Validation Checks, full Idea Validation Report |
| `quick_kill_check` | `src/prompts/quick-kill-check.ts` | 60-second triage; surfaces strongest single kill reason if S/A evidence exists; never issues GO |
| `steelman_against` | `src/prompts/steelman-against.ts` | Red-team mode; surfaces only disconfirming evidence; ends with strongest single reason to walk away |
| `run_single_gate` | `src/prompts/run-single-gate.ts` | Deep dive on one gate (competitor / market / platform / wtp / why_now); no Validation Checks |
| `generate_test_cards` | `src/prompts/generate-test-cards.ts` | 3–7 Strategyzer Test Cards tied to riskiest assumptions; cheapest-test only (never "build the MVP") |

## The 12 Tools Status

Per spec §7. Built status as of 2026-05-20:

| # | Tool | File | G1 | G2 | G3 | G4 | G5 | Status |
|---|------|------|:--:|:--:|:--:|:--:|:--:|:------:|
| 1 | `find_closest_competitor` | `src/tools/find-closest-competitor.ts` | **P** | s | | | | ✅ Built |
| 2 | `read_competitor_changelog` | `src/tools/read-competitor-changelog.ts` | **P** | | s | s | | ✅ Built |
| 3 | `scan_producthunt_launches` | `src/tools/scan-producthunt-launches.ts` | s | s | | | s | ✅ Built |
| 4 | `map_competitive_weaknesses` | `src/tools/map-competitive-weaknesses.ts` | **P** | s | | s | | ✅ Built |
| 5 | `get_category_failure_modes` | `src/tools/get-category-failure-modes.ts` | s | s | s | s | s | ✅ Built |
| 6 | `find_yc_rfs_alignment` | `src/tools/find-yc-rfs-alignment.ts` | | s | | | **P** | ✅ Built |
| 7 | `find_pricing_anchors` | `src/tools/find-pricing-anchors.ts` | s | | | **P** | | ✅ Built (P0) |
| 8 | `check_big_tech_encroachment` | `src/tools/check-big-tech-encroachment.ts` | | | **P** | | s | ✅ Built (P0) |
| 9 | `find_why_now_signals` | _not yet_ | | | | | **P** | ❌ Not built (P0) |
| 10 | `estimate_demand_signals` | _not yet_ | | **P** | | | s | ❌ Not built (P0) |
| 11 | `find_public_revenue_signals` | _not yet_ | s | **P** | | **P** | | ❌ Not built (P1) |
| 12 | `assess_platform_dependency` | _not yet_ | | | **P** | | | ❌ Not built (P1) |

**P** = primary (must call for that gate); **s** = secondary.

**Built:** 8 of 12. **Remaining P0:** `find_why_now_signals`, `estimate_demand_signals`. **Remaining P1:** `find_public_revenue_signals`, `assess_platform_dependency`. Until P0 tools land, Gates 2 and 5 lack a primary tool and will be evidence-thin (forced toward Inconclusive).

### Tool reuse rule (spec §7)

Multi-gate tools are called once and referenced across gates. Methodology Notes lists each call once with the gates it informed.

- `find_closest_competitor` — fired in G1, referenced in G2/G4
- `read_competitor_changelog` — fired in G1, referenced in G3/G4
- `get_category_failure_modes` — fired once early, referenced across all 5
- `find_public_revenue_signals` — will fire in G2, referenced in G4
- `check_big_tech_encroachment` — fired in G3, referenced in G5

## Anti-Bias Mechanisms

Per spec §1, five mechanisms make confirmation bias structurally impossible. Each must be enforced somewhere in the code path:

1. **Tier (S/A/B/C/D) + bias flag (independent/vendor-funded/conflicted/unknown) on every fact.** Enforced at the tool layer via the `ToolSource` interface in `src/types.ts:1-7`. Every tool's `sources[]` array carries both labels per source URL. Prompts cannot fabricate or override these (Appendix B(3)).
2. **DOK 1→4 layering.** Enforced in prompt instructions — see `src/prompts/validate-idea.ts:35-43` OPERATING RULES #2. The model is required to separate Facts (DOK 1) from Summary (DOK 2) from Insights labeled ⚠️ (DOK 3) from Verdict (DOK 4).
3. **Contradicting evidence search required before any gate verdict.** Enforced in prompt instructions: `src/prompts/validate-idea.ts` Step 1(e) ("Search for contradicting evidence (separate tool calls if needed)") and OPERATING RULES #3 ("No contradicting evidence surfaced — treat as a gap, not confirmation.").
4. **Three Validation Checks audit the verdict.** Enforced in `src/prompts/validate-idea.ts` Step 2 — Source Quality / Counterargument / Logic & Coherence. Major issues → confidence downgrade; Fundamental flaws → verdict override to Inconclusive.
5. **Blank "Your Spiky POV" section in the final report.** Enforced in `src/prompts/validate-idea.ts` Step 6 — model is explicitly told to LEAVE IT BLANK. Per Appendix B(4), implementation must not "helpfully" fill it in.

## Critical Implementation Rules (Appendix B)

1. **Resources are loaded fresh per invocation.** `loadResource()` in `src/index.ts:41-43` calls `readFileSync` inside the resource callback (not at import). The model re-reads them each time the prompt fires. Do NOT hoist resource reads to module scope.
2. **Tool calls may be batched within a gate; never aggressively parallelized across gates.** The master prompt's workflow is sequential per gate — later gates can depend on earlier gate findings. Per-gate parallel tool fan-out (e.g. 3 changelogs at once) is fine.
3. **Tier and bias flag are assigned at the tool layer, never the prompt layer.** Tools own `ToolSource.tier` and `ToolSource.bias`. Prompts reason about labeled data only; they cannot upgrade an `unknown` flag to `independent`.
4. **"Your Spiky POV" must remain blank.** The prompt instructs this explicitly. No post-processing step may fill it.
5. **Verdict math runs before Validation Check overrides.** Step 4 of master workflow runs fail-2 math; Step 3's Validation Checks can then override. The order is mechanical-then-override; do not shortcut.
6. **Confidence ratings are conservative.** Default `unknown` bias to `vendor-funded` for confidence math (spec §4). Lower-tier-when-uncertain.
7. **`dotenv` must load with `quiet: true`.** `src/index.ts:13-16` — dotenv v17+ logs to stdout by default, which corrupts the JSON-RPC stdio channel.
8. **Never soft-fail tool calls.** Spec §11 anti-pattern: tools must surface failures in `confidence_note` and log them in the report's Methodology Notes. Made-up data is forbidden.

## Key Abstractions

**`ToolResult<T>` (`src/types.ts:9-14`):**
- Purpose: standard envelope for every tool. Forces every fact-producing call site to attach provenance.
- Fields: `data: T`, `sources: ToolSource[]`, `confidence_note: string`, `fallbacks_used: string[]`
- Pattern: every tool in `src/tools/*.ts` returns this shape; the MCP serializes it as JSON in the tool response.

**`ToolSource` (`src/types.ts:1-7`):**
- Purpose: per-URL provenance record. The DOK 1 contract from spec §4 in code form.
- Fields: `url`, `tier` (S–D), `bias` (independent/vendor-funded/conflicted/unknown), `fetched_at` ISO timestamp, `contribution` one-line summary.

**Lib client convention (e.g. `src/lib/serper.ts`):**
- Each external API client exports: a `search`/`fetch` function, an `isXyzLive()` boolean (key configured?), a `xyzSource()` helper that builds a `ToolSource`, and a `xyzConfidenceNote()` helper for the standardized fallback message.
- Pattern: tools compose these helpers rather than reimplementing tier/bias assignment per call site.

## Entry Points

**`src/index.ts` (stdio MCP server):**
- Triggered by: AI assistant spawning the `weather` bin from `package.json` (`./build/index.js`)
- Responsibilities: load `.env`, instantiate `McpServer({name: 'product-validation', version: '0.1.0'})`, register 3 resources + 8 tools + 5 prompts, connect `StdioServerTransport`
- Logs go to stderr only (stdout reserved for JSON-RPC)

## Architectural Constraints

- **Single-threaded Node event loop.** No worker threads; all IO is async/await over `fetch`.
- **Stdio JSON-RPC channel is sacred.** Anything writing to stdout corrupts the protocol — hence `dotenv` `quiet: true` and `console.error` for logs.
- **Module-level state:** the cache `Map` in `src/lib/cache.ts:6` is the only shared mutable state. Lives for the process lifetime.
- **No persistent storage.** No database, no filesystem writes (resources are read-only).
- **Node 18+ required** for global `fetch`.
- **ESM-only.** `"type": "module"` in `package.json`; all imports use `.js` extensions even from `.ts` source.

## Anti-Patterns

### Caching resources at startup

**What happens:** Reading resource markdown files once at module load, then serving the cached string forever.
**Why it's wrong:** Appendix B(1) requires fresh loads per invocation so the model re-grounds. Also breaks hot-editing during dev.
**Do this instead:** Read inside the resource callback as `src/index.ts:41-43` does (`loadResource()` called from inside each `server.resource(...)` handler).

### Letting the prompt assign tier/bias

**What happens:** A prompt tells the model "rate this Reddit post as A-tier independent."
**Why it's wrong:** Appendix B(3) — provenance must be assigned at the tool layer where the source's funding/affiliation is known. Prompt-layer assignment lets the model rationalize.
**Do this instead:** Tools attach `ToolSource` records with tier+bias decided from source-type heuristics (see `src/lib/serper.ts` `serperSource()`).

### Soft-failing a tool call

**What happens:** API returns an error and the tool returns plausible-looking synthesized data so the workflow doesn't break.
**Why it's wrong:** Spec §11 explicit anti-pattern; pollutes the audit trail.
**Do this instead:** Return empty `data` with a descriptive `confidence_note` and a non-empty `fallbacks_used`. The prompt logs it in Methodology Notes.

### Auto-filling "Your Spiky POV"

**What happens:** The model summarizes its own opinion in the user's section.
**Why it's wrong:** Defeats the whole anti-bias property — the section exists so the user does their own DOK 4. Appendix B(4).
**Do this instead:** Leave it blank with the disclaimer block shown in spec §5 / `src/prompts/validate-idea.ts` Step 6.

### Defaulting `unknown` bias to `independent`

**What happens:** Source whose funding can't be determined gets treated as neutral.
**Why it's wrong:** Spec §11 — must default to `vendor-funded` for confidence math.
**Do this instead:** Lib helpers tag uncertain sources `unknown` and the prompt math treats them as `vendor-funded` (per spec §4 rule 4).

## Error Handling

**Strategy:** Tool layer catches errors from lib clients, downgrades confidence, returns a `ToolResult<T>` with explanatory `confidence_note`. The MCP server itself only catches in `main().catch(...)` (`src/index.ts:109-112`).

**Patterns:**
- API key absent → lib client returns stub data, tool records the fallback in `fallbacks_used` (`src/lib/serper.ts:17-21`)
- HTTP non-2xx → logged via `console.error` (stderr-safe), tool returns empty data + caveat note
- The prompt instructs the model: "If a tool call fails or returns nothing, log it in Methodology Notes. Never fabricate." (`src/prompts/validate-idea.ts:44`)

## Cross-Cutting Concerns

**Logging:** `console.error` only (stdout reserved for JSON-RPC). Every lib client prefixes log lines with `[<file>.ts]`.
**Validation:** zod schemas at MCP boundaries — every tool's `inputSchema` and every prompt's args are zod-typed.
**Provenance:** uniform `ToolSource` shape across all tools; tier+bias are first-class fields of the contract.
**Caching:** module-level `Map` in `src/lib/cache.ts` with TTL tiers (SHORT 5m / MEDIUM 1h / LONG 24h). Used by tools to dedupe within a workflow.
**Configuration:** all secrets (`SERPER_API_KEY`, `PRODUCTHUNT_TOKEN`, etc.) via `process.env`; `.env` loaded once at startup with `quiet: true`.

---

*Architecture analysis: 2026-05-20*
