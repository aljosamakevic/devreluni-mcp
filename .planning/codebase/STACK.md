# Technology Stack

**Analysis Date:** 2026-05-20

This stack powers the **ProductValidation MCP** server defined in `.planning/spec/build-spec-v1.0.md`. Every stack choice is in service of the spec's single defining design goal (§1): *make confirmation bias structurally impossible*. That means the runtime must be (a) hostable inside the user's AI assistant via MCP, (b) able to enforce the tier+bias labeling contract at the data layer (§4, §7), and (c) capable of graceful degradation when paid APIs are unavailable (§7, §11).

## Languages

**Primary:**
- TypeScript 6.0.3 — all source under `src/` is `.ts`, strict mode on (`tsconfig.json:9`). Used because the spec's `ToolResult<T>` envelope (§7) is best enforced with a typed contract; `src/types.ts` defines `ToolSource` and `ToolResult<T>` as compile-time guards against shipping facts without `tier` and `bias` fields.

**Secondary:**
- Markdown — the three MCP resources are static `.md` files under `src/resources/` (`source-tier-bias.md`, `tool-to-gate-map.md`, `evaluation-lens-matrix.md`). Per spec §8, these are loaded as resources and per Appendix B §1 must be **read fresh per invocation**, not cached at startup. `src/index.ts:41-43` honors this with a per-request `loadResource()` call.

## Runtime

**Environment:**
- Node.js (ES2022 target, `tsconfig.json:3`)
- ESM modules (`"type": "module"` in `package.json:6`, `module: "NodeNext"` in tsconfig)
- Shebang `#!/usr/bin/env node` on `src/index.ts:1` — the compiled `build/index.js` is the MCP server binary
- Transport: stdio (`StdioServerTransport` at `src/index.ts:99`) — the MCP form-factor required by spec §1 ("MCP rather than a web app")

**Package Manager:**
- npm (lockfile `package-lock.json` present at project root)

## Frameworks

**Core:**
- `@modelcontextprotocol/sdk` ^1.29.0 — the MCP SDK. Provides `McpServer` (`src/index.ts:45`), `registerTool`, `registerPrompt`, and `server.resource()`. This is the only viable choice for the spec's chosen form-factor — per §1, the MCP form-factor "allows the validation to live inside the user's existing AI assistant (Claude Desktop, Cursor, etc.)".
- `zod` ^3.25.76 — input schema validation for every tool. Used inline in every `src/tools/*.ts` `inputSchema:` block (e.g., `src/tools/check-big-tech-encroachment.ts:120-131`). Spec §7 mandates structured tool I/O; zod enforces it at the boundary.

**Testing:**
- None configured. `package.json:11` has `"test": "echo \"Error: no test specified\" && exit 1"`. Per spec §10 Phase 4, the testing strategy is *empirical calibration* — re-run known-outcome ideas (notably "AI-native focus app" expected NO-GO) rather than unit tests.

**Build/Dev:**
- `typescript` 6.0.3 — strict ESM compile to `build/`
- `tsx` 4.21.0 (dev) — direct TS execution during development
- `@types/node` 25.7.0 — Node typings
- Build command: `tsc && chmod 755 build/index.js` (`package.json:13`) — chmod is required because the output is an executable bin (`package.json:8`)

## Key Dependencies

**Critical:**
- `dotenv` ^17.4.2 — loads API keys from `.env`. Loaded with `quiet: true` at `src/index.ts:13-16`. This is **not cosmetic**: dotenv v17+ logs `injected env (N)` to stdout by default, which corrupts the JSON-RPC channel an MCP server uses over stdio. The `.env` is resolved relative to the package root regardless of cwd so Claude Desktop (which spawns servers from `/`) can find it.

**Infrastructure:**
- In-memory cache (`src/lib/cache.ts`) — TTL-keyed `Map<string, CacheEntry>`. Used by `src/lib/hn.ts:32` to dedupe HN Algolia calls. Spec Appendix B §2 allows tool-result caching within a single workflow run; this is the implementation.
- No DB, no queue, no external persistence. Per spec §2 ("MCP primitives used"), the server is stateless beyond the in-process cache.

## Configuration

**Environment:**
- `.env` (gitignored) + `.env.example` (committed) at project root
- Keys per `.env.example`:
  - `SERPER_API_KEY` — Google Search (Serper). 2,500 free/mo. Powers web search, competitor lookup, weakness mapping, **and Reddit discussions via `site:reddit.com`** (see INTEGRATIONS.md).
  - `PRODUCTHUNT_API_KEY` — Product Hunt v2 GraphQL.
  - `GITHUB_TOKEN` — declared for the upcoming `estimate_demand_signals` tool (P0, Phase 2 #4 per spec §10), not yet wired up.
- All keys are optional. Per spec §7 and §11 ("Paid API fallback works gracefully"), missing keys must trigger fallback paths, not failures. Implementation: `isSerperLive()` (`src/lib/serper.ts:62`), `isPHLive()` (`src/lib/producthunt.ts:110`), `isRedditLive()` (`src/lib/reddit.ts:82`). Each tool checks these guards and pushes a string into `fallbacks_used[]` when degraded.

**Build:**
- `tsconfig.json` — strict, ESM, ES2022, `rootDir: src`, `outDir: build`
- No bundler — Node consumes the emitted `.js` directly.

## Platform Requirements

**Development:**
- Node 20+ (implied by ES2022 target + ESM + `@modelcontextprotocol/sdk` ^1.29)
- API keys in `.env` (optional — server runs with stubs if absent)

**Production:**
- Spawned by an MCP host (Claude Desktop, Cursor, Claude Code) over stdio. No HTTP server, no port. The host invokes `build/index.js` as a subprocess and speaks JSON-RPC over stdin/stdout.

## Spec-to-implementation alignment

Where the stack comes from the spec:

| Spec section | Implication | Implementation |
|---|---|---|
| §1 "MCP rather than a web app" | Must use MCP SDK; no HTTP framework | `@modelcontextprotocol/sdk` + stdio transport (`src/index.ts:99`) |
| §2 "MCP primitives used" — Prompts, Tools, Resources | All three primitives must be wired | `server.resource()` (3×, lines 51-79), `registerTool` (8×, lines 82-89), prompt registrations (5×, lines 92-96) |
| §4 "Every fact must carry **both** tier and bias" | Type system must reject untagged sources | `src/types.ts:1-7` — `ToolSource` makes `tier` and `bias` required fields with literal-union types; missing them is a compile error |
| §7 standard return shape `{ data, sources, confidence_note, fallbacks_used }` | Generic envelope, enforced uniformly | `src/types.ts:9-14` — `ToolResult<T>` |
| §7 "If a paid API key isn't configured, tool falls back to free sources and lowers confidence rating in `confidence_note`. Never fail silently." | Per-integration live/stub guards | `isSerperLive()`, `isPHLive()`, `isRedditLive()` + stub generators in each `src/lib/*.ts`; tools push to `fallbacks_used` and inject `confidence_note` text |
| §11 anti-pattern "Soft-failing tool calls (returning made-up data when the API fails)" | Stubs must be *clearly marked* as stubs, not silently substituted | All stubs prefix titles/snippets with `[STUB]` and include "set X_API_KEY" in `contribution` (e.g., `src/lib/serper.ts:45-60`, `src/lib/producthunt.ts:94-108`) |
| §11 "Defaulting `unknown` bias flag to 'independent' (must default to 'vendor-funded')" | Bias-flag default policy is in source-level helpers | Stub sources use `bias: 'unknown'` (`src/lib/serper.ts:71`), which spec §4 rule 4 says "treat as `vendor-funded` for confidence math" — handled at the prompt layer, not coerced silently |
| §10 Phase 1 (Skeleton done) + Phase 2 in progress | 6 existing + 2 new P0 tools shipped, 4 P0/P1 remaining | `src/index.ts:82-89` registers 8 tools; missing: `find_why_now_signals`, `estimate_demand_signals`, `find_public_revenue_signals`, `assess_platform_dependency` |
| Appendix B §1 "Resources must be loaded fresh per invocation" | No startup-time resource caching | `loadResource()` called from inside the per-request handler at `src/index.ts:41-43`, 56, 65, 74 |

**Non-negotiables encoded in the stack:**
- Per §11, **paid API fallback is non-negotiable** — implementation uses graceful degradation via `isXxxLive()` checks before every network call, and every stub is honest about being a stub.
- Per §4 rule 4, `unknown` bias defaults to vendor-funded for confidence math — encoded as a literal type in `src/types.ts`, *not* coerced silently to `independent`.
- Per Appendix B §3, **tier and bias are assigned at the tool layer, not the prompt layer** — every `*Source()` helper (`serperSource`, `redditSource`, `phSource`, `hnSource`) is in `src/lib/`, called by tools, never by prompts.

---

*Stack analysis: 2026-05-20*
