# Codebase Structure

**Analysis Date:** 2026-05-20

## Implementation completeness vs spec

Checklist of every prompt (spec §6) and tool (spec §7) with file location and build status.

### Prompts (spec §6) — 5 of 5 built

| # | Prompt | Spec | File | Status |
|---|--------|------|------|:------:|
| 6.1 | `validate_idea` | §6.1 | `src/prompts/validate-idea.ts` | ✅ |
| 6.2 | `steelman_against` | §6.2 | `src/prompts/steelman-against.ts` | ✅ |
| 6.3 | `run_single_gate` | §6.3 | `src/prompts/run-single-gate.ts` | ✅ |
| 6.4 | `generate_test_cards` | §6.4 | `src/prompts/generate-test-cards.ts` | ✅ |
| 6.5 | `quick_kill_check` | §6.5 | `src/prompts/quick-kill-check.ts` | ✅ |

### Tools (spec §7) — 12 of 12 built ✅

| # | Tool | Spec | File | Priority | Status |
|---|------|------|------|:--------:|:------:|
| 1 | `find_closest_competitor` | §7 existing | `src/tools/find-closest-competitor.ts` | existing | ✅ |
| 2 | `read_competitor_changelog` | §7 existing | `src/tools/read-competitor-changelog.ts` | existing | ✅ |
| 3 | `scan_producthunt_launches` | §7 existing | `src/tools/scan-producthunt-launches.ts` | existing | ✅ |
| 4 | `map_competitive_weaknesses` | §7 existing | `src/tools/map-competitive-weaknesses.ts` | existing | ✅ |
| 5 | `get_category_failure_modes` | §7 existing | `src/tools/get-category-failure-modes.ts` | existing | ✅ |
| 6 | `find_yc_rfs_alignment` | §7 existing | `src/tools/find-yc-rfs-alignment.ts` | existing | ✅ |
| 7 | `find_pricing_anchors` | §7 new P0 | `src/tools/find-pricing-anchors.ts` | P0 | ✅ |
| 8 | `check_big_tech_encroachment` | §7 new P0 | `src/tools/check-big-tech-encroachment.ts` | P0 | ✅ |
| 9 | `find_why_now_signals` | §7 new P0 | `src/tools/find-why-now-signals.ts` | P0 | ✅ |
| 10 | `estimate_demand_signals` | §7 new P0 | `src/tools/estimate-demand-signals.ts` | P0 | ✅ |
| 11 | `find_public_revenue_signals` | §7 new P1 | `src/tools/find-public-revenue-signals.ts` | P1 | ✅ |
| 12 | `assess_platform_dependency` | §7 new P1 | `src/tools/assess-platform-dependency.ts` | P1 | ✅ |

### Phase 01 additions — validation pipeline

| # | Tool | File | Purpose | Status |
|---|------|------|---------|:------:|
| 13 | `finalize_validation_report` | `src/tools/finalize-validation-report.ts` | Validate JSON ValidationReport → deterministic markdown | ✅ |

### Resources (spec §8) — 3 of 3 built

| # | Resource | Spec | File | Status |
|---|----------|------|------|:------:|
| 8.1 | Source Tier & Bias Flag Definitions | §4 / §8.1 | `src/resources/source-tier-bias.md` | ✅ |
| 8.2 | Tool-to-Gate Map | §7 / §8.2 | `src/resources/tool-to-gate-map.md` | ✅ |
| 8.3 | Evaluation Lens Matrix | §9 / §8.3 | `src/resources/evaluation-lens-matrix.md` | ✅ |

**Net remaining for v1 completion:** 0 tools (Phase 01 completed all spec §7 tools and added the validation pipeline). Tool count is now **13** (12 data + 1 finalize).

## Directory Layout

```text
devreluni-mcp/
├── .planning/              # GSD planning + spec + codebase maps (not shipped)
│   ├── spec/
│   │   └── build-spec-v1.0.md
│   ├── codebase/           # this file lives here
│   └── validation-runs/    # calibration artifacts (Phase 01+)
├── build/                  # tsc output (runtime artifact)
├── node_modules/
├── scripts/                # one-off CLI scripts (assertion harnesses, etc.)
│   └── assert-fomi-run.ts  # mechanical 6/6 assertions for Fomi calibration
├── src/
│   ├── index.ts            # MCP server bootstrap (stdio transport)
│   ├── types.ts            # ToolResult<T> / ToolSource contract
│   ├── lib/                # shared infrastructure (HTTP clients, cache, bias, wayback, github)
│   ├── prompts/            # 5 MCP prompts (workflow templates)
│   ├── resources/          # 3 static markdown reference docs
│   ├── tools/              # MCP tools (12 data fetchers + 1 finalize tool)
│   └── validation/         # Phase 01: code-enforced report validator + renderer
│       ├── types.ts
│       ├── schema.ts
│       ├── structural-validator.ts
│       ├── verdict-validator.ts
│       ├── renderer.ts
│       ├── constants.ts
│       └── __fixtures__/synthetic-report.ts
├── package.json            # "type": "module", bin → ./build/index.js
├── package-lock.json
└── tsconfig.json
```

## Directory Purposes

**`src/`:**
- Purpose: all TypeScript source
- Key files: `index.ts` (entry), `types.ts` (shared contract)

**`src/lib/`:**
- Purpose: shared infrastructure used by tools — external API clients, in-memory cache, raw fetch helpers, bias math
- Contains: 10 modules; external-API libs each export a search/fetch function + `isXyzLive()` + `xyzSource()` helper + `xyzConfidenceNote()` helper
- Key files:
  - `src/lib/serper.ts` — Google search via Serper API (foundational; most tools use this)
  - `src/lib/reddit.ts` — Reddit signals via Serper site-restricted queries + `getSubredditMeta()`
  - `src/lib/hn.ts` — Hacker News via Algolia Search API
  - `src/lib/producthunt.ts` — Product Hunt search
  - `src/lib/webfetch.ts` — raw HTTP fetch + HTML strip (used for pricing pages, changelogs, Wayback)
  - `src/lib/cache.ts` — in-memory TTL cache (`SHORT` 5m / `MEDIUM` 1h / `LONG` 24h)
  - `src/lib/bias.ts` — `effectiveBias(flag)` helper for confidence math (Phase 01 — H3 fix)
  - `src/lib/wayback.ts` — Wayback Machine CDX API client; only returns verified snapshots (Phase 01 — H8 fix)
  - `src/lib/github.ts` — GitHub REST client for public repo stats (Phase 01)
  - `src/lib/platform-keywords.ts` — static keyword map used by `assess_platform_dependency` and friends

**`src/prompts/`:**
- Purpose: MCP prompt definitions — workflow templates the user invokes from their AI assistant
- Contains: one file per prompt; each exports `registerXyzPrompt(server)` and calls `server.prompt(name, zodSchema, factory)`
- Naming: kebab-case file = snake_case prompt name (e.g. `validate-idea.ts` → `validate_idea`)
- See §6 of spec for each prompt's full instruction body and arguments

**`src/resources/`:**
- Purpose: static markdown reference docs the model re-reads per invocation (Appendix B(1))
- Contains: 3 markdown files — read fresh inside resource callbacks in `src/index.ts:51-79`
- Generated: No (hand-authored from spec §4, §7, §9)
- Committed: Yes

**`src/tools/`:**
- Purpose: MCP tools — live-data fetchers returning `ToolResult<T>` with tier+bias-labeled sources, plus the Phase 01 validator pipeline entry point
- Contains: 12 spec §7 tools + 1 `finalize_validation_report` = **13 registered tools**
- Naming: kebab-case file = snake_case tool name (e.g. `find-pricing-anchors.ts` → `find_pricing_anchors`, `finalize-validation-report.ts` → `finalize_validation_report`)
- Each exports `registerXyz(server)` and calls `server.registerTool(name, {description, inputSchema}, handler)`

**`src/validation/`** (Phase 01):
- Purpose: code-enforced validation of the structured `ValidationReport` JSON produced by `validate_idea`. Closes H1/H2/H4/H5 mechanically.
- Files:
  - `types.ts` — `ValidationReport` typed shape (spec §5)
  - `schema.ts` — zod schema with structural invariants
  - `structural-validator.ts` — DOK separation + Contradicting Evidence + blank POV (H1, H2)
  - `verdict-validator.ts` — source-count + decision-matrix overrides (H4, H5)
  - `renderer.ts` — deterministic markdown rendering (defense-in-depth on POV)
  - `constants.ts` — `SPIKY_POV_BLANK_TEMPLATE`, `CONTRADICTING_EVIDENCE_NONE_SENTINEL`
  - `__fixtures__/synthetic-report.ts` — test fixtures for validator self-checks
- Invoked exclusively by `src/tools/finalize-validation-report.ts`. No other code path may render the final markdown.

**`scripts/`** (Phase 01):
- Purpose: one-off CLI scripts run via `tsx`. Not bundled into the MCP package.
- Files:
  - `scripts/assert-fomi-run.ts` — mechanical assertion harness for the Fomi calibration artifact. Exits 0 on `6/6 assertions passed`, non-zero with failed-assertion id on regression.

**`.planning/validation-runs/`** (Phase 01):
- Purpose: calibration artifacts (recorded `validate_idea` runs against canonical test ideas). Used as regression evidence for the H7 calibration gate.
- Contains: `01-fomi-focus-app.md` (NO-GO verdict with 3 sourced killshots), `01-fomi-focus-app-tool-response.json` (raw tool envelope), `01-fomi-focus-app-tool-responses/` (per-tool capture), `README.md`.

**`build/`:**
- Purpose: tsc compilation output; entry point referenced by `package.json` `bin`
- Generated: Yes (`npm run build`)
- Committed: typically no (build artifact)

**`.planning/`:**
- Purpose: GSD spec + planning + codebase maps; not part of the shipped package
- Committed: Yes (project knowledge artifacts)

## Key File Locations

**Entry Points:**
- `src/index.ts`: MCP server bootstrap — registers all primitives, connects stdio
- `build/index.js`: compiled entry referenced by `package.json` `bin.weather`

**Configuration:**
- `package.json`: `"type": "module"`, `bin.weather` → `./build/index.js`, dependencies (`@modelcontextprotocol/sdk`, `dotenv`, `zod`)
- `tsconfig.json`: TypeScript compilation config
- `.env` (gitignored): API keys — `SERPER_API_KEY`, `PRODUCTHUNT_TOKEN`, etc.

**Core Contract:**
- `src/types.ts`: `ToolResult<T>` / `ToolSource` — the data shape every tool returns

**Spec:**
- `.planning/spec/build-spec-v1.0.md`: source of truth (852 lines)

**Testing:**
- _None yet._ No test runner, no test files. Spec §10 Phase 4 calls for testing/calibration but no automated suite exists.

## Naming Conventions

**Files:**
- kebab-case: `find-pricing-anchors.ts`, `evaluation-lens-matrix.md`
- One file per MCP primitive (tool / prompt / resource)
- Parallel naming: file basename matches the MCP-registered name with `_` ↔ `-` (e.g. `find_pricing_anchors` ↔ `find-pricing-anchors.ts`, `finalize_validation_report` ↔ `finalize-validation-report.ts`)

**Directories:**
- lowercase plural for collections (`tools/`, `prompts/`, `resources/`, `lib/`)

**Exports:**
- Tools/prompts: `registerXyz(server)` named export — used by `src/index.ts` for wiring
- Lib helpers: named exports `xyzSearch`, `isXyzLive`, `xyzSource`, `xyzConfidenceNote`

**Imports:**
- ESM-only; every relative import uses `.js` extension even from `.ts` source (e.g. `from '../types.js'`) per Node ESM resolution

## Where to Add New Code

**New tool (post Phase 01 — all spec §7 tools shipped; pattern still applies for future tools):**
- Primary code: `src/tools/<kebab-name>.ts`
- Pattern: copy `src/tools/find-why-now-signals.ts` (Phase 01 reference — Serper + bias-helper integration), or `src/tools/assess-platform-dependency.ts` (uses `src/lib/platform-keywords.ts`)
- Export: `register<PascalName>(server)`
- Wire up: add import + call in `src/index.ts`, update startup log
- Resource map: also add an entry in `src/resources/tool-to-gate-map.md` so the model sees it
- Return shape: `ToolResult<...Data>` per `src/types.ts`
- If the tool does confidence math: import `effectiveBias` from `src/lib/bias.ts` (Phase 01 — H3 rule)

**New prompt:**
- Primary code: `src/prompts/<name>.ts`
- Pattern: copy `src/prompts/run-single-gate.ts` (mid-complexity reference)
- Wire up: add import + call in `src/index.ts`

**New external API client (e.g. SimilarWeb, Ahrefs):**
- Primary code: `src/lib/<service>.ts`
- Convention: export `xyzSearch/Fetch`, `isXyzLive()`, `xyzSource(...)` → `ToolSource`, `xyzConfidenceNote(fallback: boolean)`
- API key reads from `process.env['XYZ_API_KEY']` with stub fallback (graceful degradation per spec §7)

**New resource:**
- Primary code: `src/resources/<name>.md`
- Wire up: add `server.resource(...)` block in `src/index.ts` (lines 51-79 pattern). Must use `loadResource()` inside the callback — do not read at module scope (Appendix B(1)).

**Shared utility used by multiple tools:**
- Place in `src/lib/` — only if reused. One-off helpers stay in the tool file.

**Updating types:**
- `src/types.ts` is for the cross-cutting `ToolResult<T>` / `ToolSource` contract only. Per-tool data shapes live inline in each tool file (see `FindPricingAnchorsData` in `src/tools/find-pricing-anchors.ts:21`).

## Special Directories

**`build/`:**
- Purpose: compiled JS from `tsc`; `bin.weather` points here
- Generated: Yes (`npm run build`)
- Committed: typically no (build artifact)

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes (`npm install`)
- Committed: No

**`.planning/`:**
- Purpose: GSD spec + codebase maps; not part of the shipped package but committed for project knowledge
- Generated: No (hand-authored / agent-authored)
- Committed: Yes

## Cross-Reference: Tool/Prompt File → Spec Section

| File | Spec section defining it |
|------|--------------------------|
| `src/prompts/validate-idea.ts` | §6.1 |
| `src/prompts/steelman-against.ts` | §6.2 |
| `src/prompts/run-single-gate.ts` | §6.3 |
| `src/prompts/generate-test-cards.ts` | §6.4 |
| `src/prompts/quick-kill-check.ts` | §6.5 |
| `src/tools/find-closest-competitor.ts` | §7 (existing) |
| `src/tools/read-competitor-changelog.ts` | §7 (existing) |
| `src/tools/scan-producthunt-launches.ts` | §7 (existing) |
| `src/tools/map-competitive-weaknesses.ts` | §7 (existing) |
| `src/tools/get-category-failure-modes.ts` | §7 (existing) |
| `src/tools/find-yc-rfs-alignment.ts` | §7 (existing) |
| `src/tools/find-pricing-anchors.ts` | §7 (new P0) + Appendix A example |
| `src/tools/check-big-tech-encroachment.ts` | §7 (new P0) |
| `src/tools/find-why-now-signals.ts` | §7 (new P0) |
| `src/tools/estimate-demand-signals.ts` | §7 (new P0) |
| `src/tools/find-public-revenue-signals.ts` | §7 (new P1) |
| `src/tools/assess-platform-dependency.ts` | §7 (new P1) |
| `src/tools/finalize-validation-report.ts` | Phase 01 — H1/H2/H4/H5 hardening |
| `src/validation/*` | Phase 01 — validator + renderer pipeline |
| `src/resources/source-tier-bias.md` | §4 / §8.1 |
| `src/resources/tool-to-gate-map.md` | §7 / §8.2 |
| `src/resources/evaluation-lens-matrix.md` | §9 / §8.3 |

---

*Structure analysis: 2026-05-20*
