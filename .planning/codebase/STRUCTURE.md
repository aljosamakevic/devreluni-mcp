# Codebase Structure

**Analysis Date:** 2026-05-20

## Directory Layout

```
devreluni-mcp/
├── src/
│   ├── index.ts                # Server entrypoint — wires everything
│   ├── types.ts                # ToolResult<T>, ToolSource contracts
│   ├── tools/                  # 8 live-data MCP tools
│   ├── prompts/                # 5 framework workflow prompts
│   ├── resources/              # 3 static markdown reference docs
│   └── lib/                    # API clients + cache + webfetch
├── .planning/                  # GSD planning artifacts (this folder)
├── build/                      # tsc output (gitignored)
└── package.json / tsconfig.json / .env (not committed)
```

## Directory Purposes

**`src/`:**
- Purpose: all TypeScript source for the MCP server.
- Contains: a single `index.ts` entrypoint + a `types.ts` contracts file + four subdirectories, one per architectural surface.

**`src/tools/`:**
- Purpose: MCP tools — live data fetchers the LLM calls during a prompt workflow.
- Contains: one `.ts` per tool, each exporting a single `register<ToolName>(server)` function.
- Every tool returns a `ToolResult<T>` JSON string via `content: [{ type: 'text', text: JSON.stringify(...) }]`.

**`src/prompts/`:**
- Purpose: MCP prompts — framework workflows that orchestrate tool calls and define output format.
- Contains: one `.ts` per prompt, each exporting a single `register<PromptName>Prompt(server)` function that calls `server.prompt(...)` with a Zod schema and a message-builder.

**`src/resources/`:**
- Purpose: static markdown rubrics loaded fresh per invocation by handlers in `src/index.ts`.
- Contains: only `.md` files — no code.

**`src/lib/`:**
- Purpose: external API clients and shared utilities (cache, raw web fetch).
- Contains: thin wrappers exporting `search* / fetch*`, `*Source()` (returns a `ToolSource`), `is*Live()` (env-key probe), and `*ConfidenceNote()` helpers.

**`.planning/`:**
- Purpose: GSD planning artifacts.
- Contains: `codebase/` subdirectory with this map.
- Committed: yes.
- Generated: yes (by `/gsd-map-codebase`).

## Key File Locations

**Entry point:**
- `src/index.ts` — single wiring point. Loads `.env`, constructs `McpServer`, registers 3 resources + 8 tools + 5 prompts, connects `StdioServerTransport`.

**Type contracts:**
- `src/types.ts` — `ToolSource` and `ToolResult<T>` interfaces (everything tools return).

**Configuration:**
- `package.json` — npm scripts, deps (`@modelcontextprotocol/sdk`, `zod`, `dotenv`).
- `tsconfig.json` — TypeScript build config; emits to `build/`.
- `.env` — local API keys (`SERPER_API_KEY`, `PRODUCTHUNT_API_KEY`). Not committed.

**Build spec:**
- `build_spec_v1.0.md` (repo root, if present) — original framework spec the code implements.

## File Inventory

### `src/tools/` (8 files)

| File | Tool name (MCP) | Register export | Primary gate(s) |
|------|-----------------|-----------------|-----------------|
| `find-closest-competitor.ts` | `find_closest_competitor` | `registerFindClosestCompetitor` | G1 |
| `read-competitor-changelog.ts` | `read_competitor_changelog` | `registerReadCompetitorChangelog` | G1, G3, G4 |
| `map-competitive-weaknesses.ts` | `map_competitive_weaknesses` | `registerMapCompetitiveWeaknesses` | G1 |
| `scan-producthunt-launches.ts` | `scan_producthunt_launches` | `registerScanProductHuntLaunches` | G2, G5 |
| `get-category-failure-modes.ts` | `get_category_failure_modes` | `registerGetCategoryFailureModes` | red-team |
| `find-yc-rfs-alignment.ts` | `find_yc_rfs_alignment` | `registerFindYCRFSAlignment` | G5 |
| `find-pricing-anchors.ts` | `find_pricing_anchors` | `registerFindPricingAnchors` | G4 |
| `check-big-tech-encroachment.ts` | `check_big_tech_encroachment` | `registerCheckBigTechEncroachment` | G3 |

### `src/prompts/` (5 files)

| File | Prompt name (MCP) | Register export | Role |
|------|-------------------|-----------------|------|
| `validate-idea.ts` | `validate_idea` | `registerValidateIdeaPrompt` | Full 5-gate Pre-Build Checklist + 3 Validation Checks + Fail-2 verdict |
| `steelman_against.ts`*see file `steelman-against.ts`* | `steelman_against` | `registerSteelmanAgainstPrompt` | Red-team / disconfirming-evidence-only mode |
| `run-single-gate.ts` | `run_single_gate` | `registerRunSingleGatePrompt` | Deep-dive on one gate (G1–G5) |
| `generate-test-cards.ts` | `generate_test_cards` | `registerGenerateTestCardsPrompt` | Emit 3–7 Strategyzer test cards |
| `quick-kill-check.ts` | `quick_kill_check` | `registerQuickKillCheckPrompt` | 60-second shallow triage; cannot return GO |

### `src/resources/` (3 files)

| File | Resource URI | Purpose |
|------|--------------|---------|
| `source-tier-bias.md` | `resource://source-tier-bias` | Tier definitions (S/A/B/C/D) and bias labels reference |
| `tool-to-gate-map.md` | `resource://tool-to-gate-map` | Which tools to call per gate |
| `evaluation-lens-matrix.md` | `resource://evaluation-lens-matrix` | Framing-specific (audience × builder) pass/fail thresholds |

### `src/lib/` (6 files)

| File | Exports | Purpose |
|------|---------|---------|
| `cache.ts` | `cacheGet`, `cacheSet`, `makeCacheKey`, `TTL` | In-process Map with TTL (SHORT/MEDIUM/LONG = 5min/1h/24h) |
| `serper.ts` | `serperSearch`, `serperSource`, `serperConfidenceNote`, `isSerperLive` | Google search via Serper API; stub fallback when key missing |
| `hn.ts` | `searchHN`, `hnSource` | Hacker News via Algolia public API (no key required) |
| `producthunt.ts` | `searchProductHunt`, `phSource`, `phConfidenceNote`, `isPHLive` | Product Hunt GraphQL v2; stub fallback |
| `reddit.ts` | (Reddit-via-Serper helpers) | Reddit search via `site:reddit.com` Google query — avoids Reddit OAuth |
| `webfetch.ts` | `fetchPage`, `stripHtml` | Generic HTML fetch + tag stripping for pricing-page scraping |

### Top-level `src/`

| File | Purpose |
|------|---------|
| `index.ts` | Server entry; only file that imports from every subdir |
| `types.ts` | `ToolSource`, `ToolResult<T>` interfaces |

## Naming Conventions

### Parallel triad (tool → file → export)

Every tool follows a strict three-way naming parallel:

| MCP tool name (snake_case) | File name (kebab-case)                  | Register export (PascalCase)         |
|----------------------------|-----------------------------------------|--------------------------------------|
| `find_closest_competitor`  | `find-closest-competitor.ts`            | `registerFindClosestCompetitor`      |
| `find_pricing_anchors`     | `find-pricing-anchors.ts`               | `registerFindPricingAnchors`         |
| `check_big_tech_encroachment` | `check-big-tech-encroachment.ts`     | `registerCheckBigTechEncroachment`   |

Prompts follow the same triad, with the suffix `Prompt` on the register export:

| MCP prompt name | File name | Register export |
|-----------------|-----------|-----------------|
| `validate_idea` | `validate-idea.ts` | `registerValidateIdeaPrompt` |
| `quick_kill_check` | `quick-kill-check.ts` | `registerQuickKillCheckPrompt` |

### Lib helper conventions

For each external API, `src/lib/<service>.ts` exposes the same shape:

- `search<Service>(query, ...)` or `fetch<Thing>(...)` — the actual call (returns stub on missing key).
- `<service>Source(query): ToolSource` — builds the `ToolSource` (tier downgraded to `D` if stub).
- `is<Service>Live(): boolean` — env-key probe.
- `<service>ConfidenceNote(): string` — human-readable confidence string for `ToolResult.confidence_note`.

### Files

- TypeScript source: kebab-case (`find-closest-competitor.ts`).
- Resources: kebab-case markdown (`source-tier-bias.md`).
- Test files: not present yet.

### Directories

- Lowercase, no hyphens (`tools`, `prompts`, `resources`, `lib`).

## Where to Add New Code

**New tool:**
- File: `src/tools/<new-tool-name>.ts`
- Export: `export function registerNewToolName(server: McpServer): void`
- Use `server.registerTool(...)` with a Zod `inputSchema`.
- Return `ToolResult<T>` JSON-stringified inside `content: [{ type: 'text', text: ... }]`.
- Import lib clients from `../lib/*.js` and `ToolResult` / `ToolSource` from `../types.js`.
- Wire it: add an import + `registerNewToolName(server);` call in `src/index.ts`.
- Update `src/resources/tool-to-gate-map.md` to map it to a gate.
- Add the tool name to the `console.error` listing at `src/index.ts:103`.

**New prompt:**
- File: `src/prompts/<new-prompt-name>.ts`
- Export: `export function registerNewPromptNamePrompt(server: McpServer): void`
- Use `server.prompt(name, zodSchema, handler)` returning `{ messages: [{ role: 'user', content: { type: 'text', text: ... } }] }`.
- Wire it in `src/index.ts` and list in the startup `console.error` at line 105.

**New external integration:**
- File: `src/lib/<service>.ts`
- Follow the four-export pattern: `search/fetch...`, `<svc>Source`, `is<Svc>Live`, `<svc>ConfidenceNote`.
- Always implement a stub fallback when the key env var is missing; downgrade source tier to `D` and bias to `unknown` in the stub branch.
- Use `cacheGet`/`cacheSet` from `src/lib/cache.ts` for any call that hits the network.

**New resource (reference markdown):**
- File: `src/resources/<resource-name>.md`
- Register in `src/index.ts` using the existing `server.resource(...)` pattern — load via `loadResource('<name>.md')` inside the handler (not at module top).
- URI: `resource://<resource-name>`.

**New shared utility:**
- If it is purely process-local (e.g. caching, formatting): `src/lib/`.
- If it is a type contract: extend `src/types.ts`.

## Special Directories

**`build/`:**
- Purpose: TypeScript compile output consumed by Claude Desktop at runtime.
- Generated: yes (`tsc`).
- Committed: no (gitignored).

**`.planning/`:**
- Purpose: GSD codebase map + plan artifacts.
- Generated: yes (`/gsd-map-codebase`).
- Committed: yes.

**`.env` (not a directory, but worth noting):**
- Loaded by `src/index.ts:13` with `quiet: true` (avoids stdout corruption of the MCP JSON-RPC channel).
- Holds API keys for Serper and Product Hunt. Hacker News (Algolia) and Reddit (via Serper) need no extra keys.

---

*Structure analysis: 2026-05-20*
