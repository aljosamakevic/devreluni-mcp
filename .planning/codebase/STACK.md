# Technology Stack

**Analysis Date:** 2026-05-20

## Languages

**Primary:**
- TypeScript (compiler `^6.0.3`) — all source under `src/`, ~21 `.ts` files. Strict mode enabled (`tsconfig.json`).

**Secondary:**
- Markdown — static knowledge resources under `src/resources/` (`evaluation-lens-matrix.md`, `source-tier-bias.md`, `tool-to-gate-map.md`) served as MCP resources.

## Runtime

**Environment:**
- Node.js (no `.nvmrc` present). Targets `ES2022` with `module: NodeNext` (see `tsconfig.json`). Uses Node's built-in `fetch` (Node 18+ required) — no `node-fetch`/`axios` dependency.
- Process model: long-lived stdio process spawned by an MCP host (e.g. Claude Desktop).

**Module System:**
- ESM throughout — `"type": "module"` in `package.json`, `NodeNext` resolution in `tsconfig.json`, all imports use `.js` extensions on relative paths (e.g. `import { ... } from './tools/find-closest-competitor.js'` in `src/index.ts`).

**Package Manager:**
- npm (lockfile: `package-lock.json` present, ~58 KB). No pnpm/yarn lockfiles.

## Frameworks

**Core:**
- `@modelcontextprotocol/sdk` `^1.29.0` — MCP server framework. Uses `McpServer` (`@modelcontextprotocol/sdk/server/mcp.js`) plus `StdioServerTransport` (`@modelcontextprotocol/sdk/server/stdio.js`). Wires tools, prompts, and resources in `src/index.ts`.

**Testing:**
- None. `package.json` test script is the default `echo "Error: no test specified" && exit 1`. No `jest`, `vitest`, `mocha`, or `*.test.ts` files in the repo.

**Build/Dev:**
- `typescript` `^6.0.3` — `tsc` is the build (`npm run build` = `tsc && chmod 755 build/index.js`).
- `tsx` `^4.21.0` (devDep) — fast TS execution for local dev (no script wired in `package.json`; run ad hoc).
- Output: `build/` (per `tsconfig.json` `outDir`); `rootDir` is `./src`.

## Key Dependencies

**Critical:**
- `@modelcontextprotocol/sdk` `^1.29.0` — the entire server surface (tools, prompts, resources, transport).
- `zod` `^3.25.76` — runtime schema validation for tool input args. Used inside each `src/tools/*.ts` via the MCP SDK's `inputSchema` Zod object pattern.
- `dotenv` `^17.4.2` — loads `.env` from the package root in `src/index.ts`. Loaded with `quiet: true` because dotenv v17+ otherwise prints `"injected env (N)"` to stdout and corrupts the JSON-RPC channel.

**Infrastructure:**
- `@types/node` `^25.7.0` (devDep) — Node typings; required because `tsconfig.json` declares `"types": ["node"]`.

**No HTTP client, no ORM, no DB, no auth library** — the server is stateless and uses the platform `fetch` for all upstream calls.

## Configuration

**Environment:**
- Loaded via `dotenv` from `<package-root>/.env` (path resolved relative to `import.meta.url`, so works regardless of cwd — Claude Desktop spawns from `/`).
- Required-but-optional env vars (server runs without them, in stub mode):
  - `SERPER_API_KEY` — powers Serper, Reddit-via-Serper, and most search-driven tools.
  - `PRODUCTHUNT_API_KEY` — Product Hunt GraphQL.
  - `GITHUB_TOKEN` — declared in `.env.example` for an upcoming `estimate_demand_signals` tool; **not yet read by any code** in `src/`.
- `.env` is gitignored; `.env.example` documents the contract.

**Build:**
- `tsconfig.json` — `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `esModuleInterop: true`, `forceConsistentCasingInFileNames: true`, `skipLibCheck: true`. `include: ["src/**/*"]`, `exclude: ["node_modules"]`.

## Graceful Degradation Pattern (env-driven)

Every external integration in `src/lib/` follows the same contract:

1. **Check env var presence** — `process.env['SERPER_API_KEY']`, etc.
2. **If missing → return clearly labeled stub data** (`[STUB] Top result for: ...`) instead of throwing.
3. **Expose an `is*Live()` predicate** (`isSerperLive`, `isPHLive`, `isRedditLive`) so tools can adjust source tier and confidence notes.
4. **Expose a `*Source(query)` builder** that downgrades tier `A` → `D` and bias `independent` → `unknown` when stubbed.
5. **Expose a `*ConfidenceNote()`** that explicitly tells the caller "Set X_API_KEY for live data" when stubbed.

This means the server boots, registers all tools, and answers every call even with an empty `.env` — useful for local dev, demos, and CI — while never silently passing stub data off as real.

## `src/lib/` Dual Nature: Live Integrations vs. Stubs

Each file in `src/lib/` is simultaneously a live HTTP client **and** a stub data source:

| File | Live mode | Stub mode |
|------|-----------|-----------|
| `src/lib/serper.ts` | `POST https://google.serper.dev/search` with `X-API-KEY` | `getSerperStub()` returns 2 labeled placeholder results |
| `src/lib/reddit.ts` | Calls `serperSearch` with `site:reddit.com` suffix | Inherits Serper's stub (see `isRedditLive`) |
| `src/lib/producthunt.ts` | `POST https://api.producthunt.com/v2/api/graphql` with bearer token | `getPHStub()` returns 1 labeled placeholder post |
| `src/lib/hn.ts` | `GET https://hn.algolia.com/api/v1/search` (no auth) | Returns `[]` on failure — no key needed, no stub needed |
| `src/lib/webfetch.ts` | Generic `fetch` of any URL with browser-ish UA | None — failure returns `{ ok: false, status: 0, text: 'Fetch error: ...' }` |
| `src/lib/cache.ts` | In-process `Map` cache with TTL (`SHORT`/`MEDIUM`/`LONG`) | N/A — utility, currently only used by `hn.ts` |

## Deployment Model

- **stdio MCP server.** No HTTP listener, no port binding. The host (Claude Desktop, MCP-aware client) spawns the process and speaks JSON-RPC over stdin/stdout.
- **Logging to stderr only** — see `console.error` calls in `src/index.ts` after `server.connect(transport)`. Anything on stdout would corrupt the JSON-RPC channel (this is also why `dotenv` is loaded with `quiet: true`).
- **Binary entry point:** `package.json` declares `"bin": { "weather": "./build/index.js" }` (note: legacy name from the `weather` template; entry file is the compiled `src/index.ts` with a `#!/usr/bin/env node` shebang). Built file is `chmod 755`'d.
- **No containerization, no CI, no Procfile** — distribution model assumes local install + Claude Desktop config.

## Platform Requirements

**Development:**
- Node.js 18+ (for global `fetch`, `URL`, `URLSearchParams`).
- npm.
- Optional: API keys for Serper, Product Hunt (server boots without them).

**Production:**
- Same as dev — this is a locally-spawned subprocess, not a hosted service.

---

*Stack analysis: 2026-05-20*
