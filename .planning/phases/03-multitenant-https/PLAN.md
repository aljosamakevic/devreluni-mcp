# Phase 03 — Multi-Tenant HTTPS Transport

> **Author:** GSD planner, 2026-05-26 (v0.2)
> **Spec basis:** `.planning/spec/build-spec-v1.0.md` v1.0 (§1 anti-bias non-regression + §11 DoD), `.planning/spec/framework-context.md` (intellectual lineage), MCP spec 2025-03-26 (Streamable HTTP transport)
> **CONTEXT basis:** `.planning/phases/03-multitenant-https/CONTEXT.md` — locked decisions (Express, bearer tokens, 1,500 global Serper cap with graceful degradation, Fly.io, getvetoed.com, landing page + admin dashboard in scope)
> **Style template:** `.planning/phases/02-tool-quality-and-test-harness/PLAN.md`
> **v0.2 basis:** PLAN-CHECK v0.1 — 4 blockers (C1–C4) + 5 warnings (C5–C9) + 1 info (C10) + 5 open-questions (OQ1–OQ5) resolved.

---

## Phase Goal

Ship the ProductValidation MCP as a hosted HTTPS service at `https://getvetoed.com/mcp` with bearer-token auth, two-layer rate limiting, persistent storage on Fly.io, a public marketing landing page, and an admin dashboard for token management — without regressing **any** of the anti-bias guarantees Phase 01 hardened mechanically or the tool-quality fixes Phase 02 made.

The HTTPS layer **wraps** the existing stdio MCP server; it does not replace it. The same `McpServer` instance terminates two transports (stdio for local dev, Streamable HTTP for production). Phase 01's `src/validation/`, `src/lib/bias.ts`, `src/prompts/validate-idea.ts`, and `src/tools/finalize-validation-report.ts` are not touched in this phase.

**Tie to spec:**
- **§1 ("Make confirmation bias structurally impossible.")** — the five anti-bias mechanisms (tier+bias per fact, DOK 1→4 layering, contradicting-evidence search, three Validation Checks, blank Spiky POV) live inside `McpServer`'s prompts/tools/validators. The HTTP transport wraps that server; if the auth/transport/rate-limit layer mutates request bodies, headers, or response shape in ways that bypass the validator pipeline, the anti-bias property is lost. Stream A (transport) and Stream G (calibration regression via HTTPS) defend this.
- **§11 DoD ("validate_idea on the AI-native focus app idea returns NO-GO with sound reasoning")** — must still hold when invoked via HTTPS. T-final-3a/3b is the load-bearing fresh-LLM rerun against the deployed endpoint. `scripts/assert-fomi-run.ts` is the mechanical gate.
- **§11 anti-pattern 2 ("Soft-failing tool calls — returning made-up data when the API fails")** — applies to the new auth + rate-limit + admin layers too. 401, 429, 500, and rate-cap-exceeded responses are structured errors, never fabricated tool envelopes. Global-cap graceful-degradation in `src/lib/serper.ts` honors this by emitting `fallbacks_used` rather than silent stub data.
- **§7 graceful-degradation contract** — when SERPER global cap fires, downstream tools surface the gap honestly in `confidence_note` + `fallbacks_used`, not synthesized data.
- **Spec §11 DoD tool-call budget (<20 per `validate_idea`)** is a **hard upstream constraint** for the per-token threshold math: spec UPPER BOUND is 20 tool calls/run; 20 runs/day × 20 tool calls/run = **400 tool calls/day worst case** per token. (Typical: ~13 tool calls/run × 20 runs = ~260 tool calls/day.) The 1,500 global Serper cap math: ~13 × 20 × 5 active users = ~1,300 calls/day, leaving headroom inside the 1,500 cap.

**Inviolate constraints (carried from Phase 01 + 02):**
- After Phase 03, both `npx tsx scripts/assert-fomi-run.ts` (Phase 01 captured artifact) and the Phase 02 fresh-artifact run MUST still exit 0 (6/6 PASS).
- The 13 registered tools stay registered (12 spec §7 + 1 `finalize_validation_report`). No tool added, no tool removed.
- Stdio transport (default; `MCP_TRANSPORT` unset or `=stdio`) must keep working end-to-end. The existing Claude Desktop config pointing at the local stdio bin is the regression baseline.
- Files in `src/validation/`, `src/lib/bias.ts`, `src/prompts/validate-idea.ts`, `src/tools/finalize-validation-report.ts` are **not touched** by any task in this phase. If a task description seems to require touching them, that's a sign the plan has a bug — escalate.

---

## Goal-Backward Verification

Each CONTEXT.md success-criterion row maps to specific tasks below. If a row's tasks all pass and the criterion is still untrue, the plan has a gap.

| Success criterion (CONTEXT.md §"Success criteria") | Producing task(s) |
|---|---|
| `MCP_TRANSPORT=http node build/index.js` boots an HTTP server on port 3000 | **T01** (HTTP wrapper) + **T02** (boot-mode branch) |
| `curl -X POST localhost:3000/mcp` works end-to-end for `tools/list` + sample `tools/call` | **T01** + **T04** (local smoke test) |
| Stdio transport still works locally for development (no regression) | **T02** (`MCP_TRANSPORT` unset → stdio default; immediate `assert-fomi-run` check) + **T-final-2** |
| 401 + `WWW-Authenticate: Bearer realm="vetoed"` on missing/invalid token | **T07** (middleware) + **T08** (header) + **T10** (tests) |
| `npm run admin -- issue-token --email=alice@... ` creates token + stores in DB; `list-tokens`; `revoke-token` | **T05** (schema + connection) + **T06** (token CRUD) + **T09** (admin CLI) |
| 429 + `Retry-After` on per-token rate limit (20 validate_idea/day ⇒ 400 tool calls/day) | **T11** (per-token limiter, 400-call threshold) + **T13** (middleware) + **T15** (tests) |
| Global Serper cap → graceful degradation + structured warning (NO 429 for global cap) | **T12** (global limiter inside `src/lib/serper.ts`) + **T15** (tests) |
| Usage tracked per-token in `usage_log` | **T05** (table) + **T14** (insertion on every successful tool call) |
| App boots on Fly.io via `flyctl deploy` | **T16** (Dockerfile + scripts included) + **T17** (fly.toml + volume-create prereq) + **T18** (CI) |
| `https://getvetoed.com/mcp` resolves through DNS | **T19** (DNS docs) — requires user action; doc is the deliverable |
| `https://getvetoed.com/health` returns 200 with structured status JSON | **T03** (health endpoint) + **T22** (health enriched with DB + cache + error timestamp) |
| All 70 existing tests + new auth/ratelimit/transport tests pass (target ≥90) | **T10** + **T15** + assertions in **T-final-4** |
| Fomi calibration via HTTPS returns NO-GO with 6/6 PASS | **T-final-3a** (HTTPS client script) + **T-final-3b** (live deployed run + artifact capture) + **T-final-4** (`assert-fomi-run` against new artifact) |
| `docs/HOSTED_SETUP.md` documents user onboarding | **T20** |
| Landing page renders at `https://getvetoed.com/` | **T25** (HTML) + **T26** (static serving) |
| Admin dashboard at `/admin` with basic-auth; can list/issue/revoke tokens | **T27** (HTML + middleware + fail-closed semantics) + **T28** (admin API) + **T29** (vanilla JS wiring) |
| CONCERNS.md updated with Phase 03 deferreds (D-XX entries) | **T-final-1** |
| pino logs with redaction (API keys, request bodies > 200 chars, admin password) | **T21** (logger) — covers R6 admin-password leakage too |
| Fly metrics dashboard docs | **T23** (docs only) |
| Secrets rotation runbook | **T24** |

---

## Task Breakdown

**Total:** 35 tasks across 7 streams (was 33 in v0.1; +1 optional spike T00, +1 from T-final-3 split into T-final-3a/3b). Each task = one atomic commit.

Complexity legend (same as Phase 01/02): **S** = ≤1h, single file edit, no new external dep. **M** = 1–3h, multi-file or new internal module. **L** = 3–6h, new external integration / cross-cutting wiring / new subsystem.

**v0.2 complexity totals:** **S=15, M=15, L=3, optional=1 (T00, M).** Without the optional T00: 34 tasks (S=15, M=14, L=3). Two L tasks (T01 + T-final-3b) are the foundation and the load-bearing fresh-LLM rerun.

---

### Stream A — HTTP Transport (T00 optional spike, T01–T04)

Foundation stream. Most of Streams B/C/E/F depend on the Express app existing.

#### T00 — *(Optional, recommended)* SDK API-surface spike for Express + StreamableHTTPServerTransport
- **Goal:** **30-minute timeboxed** Context7 (or vendor docs) verification of the exact pattern for mounting `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` onto an Express handler. Confirm:
  - Constructor signature (sessionId management options, request/response handling)
  - Mounting pattern (call shape on `POST /mcp`: does the transport `handleRequest(req, res, body)`-style consume the parsed body, or own the raw `req` stream?)
  - Whether `express.json()` upstream consuming `req.body` breaks the transport (and the workaround if so)
  - SDK version verified (record exact `@modelcontextprotocol/sdk@X.Y.Z`)

  Output: notes file at `.planning/phases/03-multitenant-https/sdk-mount-spike.md` summarizing findings + 1–2 code sketches. **Do NOT block execution if T00 is skipped** — R1 mitigation gives T01 enough L-budget headroom to absorb the discovery cost. But running T00 first dramatically de-risks T01.
- **Files:** `.planning/phases/03-multitenant-https/sdk-mount-spike.md` (new, ~30 lines).
- **Spec refs:** OQ1 (PLAN-CHECK §Q10); R1 mitigation.
- **Acceptance:**
  - File exists with SDK version captured + the verified mount pattern documented.
  - Document is referenced by name in T01's file-header comment (so future readers can find the source).
- **Dependencies:** none
- **Complexity:** M (timeboxed; 30 min target, hard cap 1h)

#### T01 — Add Express HTTP wrapper with Streamable HTTP transport
- **Goal:** New `src/http/server.ts` that creates an Express `app`, mounts `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamable-http.js` at `POST /mcp`, and exports `createHttpServer(mcpServer: McpServer): { app: express.Express; listen: (port: number) => http.Server }`. The transport is connected to the **same `McpServer` instance** that stdio mode uses — no duplication of tool/prompt/resource registrations.

  **Verification step (BEFORE downstream tasks build on this):** prototype the exact mounting pattern. If T00 ran, its output answers most of this. Otherwise the MCP SDK's Streamable HTTP examples in docs may use a different framework (Hono / raw Node). If Express needs extra glue (manual chunked-body handling, response stream forwarding, session-id header propagation), discover it here and document in code comments + `docs/HOSTED_SETUP.md` (T20).

  Express setup:
  - `app.use(express.json({ limit: '1mb' }))` — JSON-RPC bodies are small; cap defends against payload-abuse 413.
  - `app.disable('x-powered-by')` (basic hygiene).
  - Route ordering reserved (defined now, wired by later tasks): `/health` (T03), `/mcp` (this task, auth-gated in T07 wave), `/admin/*` (Stream F), `/` static (Stream F).
- **Files:** `src/http/server.ts` (new, ~80 lines); `package.json` (add `express`, `@types/express` to deps/devDeps).
- **Spec refs:** §1 anti-bias non-regression (transport must not mutate request/response bodies in ways that bypass validator); CONTEXT.md decision 5 + 6.
- **Acceptance:**
  - `npm install` succeeds with `express` added.
  - `import { createHttpServer } from './http/server.js'` resolves.
  - File contains exactly ONE call to `new StreamableHTTPServerTransport(...)` and ONE call to `mcpServer.connect(transport)`.
  - **(C10)** File-header comment records the verified SDK package version + entry point path, e.g.:
    ```
    // SDK verified: @modelcontextprotocol/sdk@<X.Y.Z>
    // Entry point: '@modelcontextprotocol/sdk/server/streamable-http.js'
    // Mount pattern source: .planning/phases/03-multitenant-https/sdk-mount-spike.md (if T00 ran)
    //                       OR Context7 lookup at <date>
    ```
    Makes the integration auditable when the SDK API evolves.
  - `grep -n "StreamableHTTPServerTransport" src/http/server.ts` returns ≥1 match.
  - `grep -nE "@modelcontextprotocol/sdk@[0-9]+\.[0-9]+\.[0-9]+" src/http/server.ts` returns ≥1 match (forces literal version capture in the comment).
- **Dependencies:** T00 (optional but recommended)
- **Complexity:** L

#### T02 — Branch `src/index.ts` on `MCP_TRANSPORT` env var (stdio default; http opt-in)
- **Goal:** Refactor `src/index.ts:108-117` so the entry point selects transport based on `process.env['MCP_TRANSPORT']`:
  - Unset OR `=stdio` (default): existing `StdioServerTransport` path, unchanged behavior.
  - `=http`: import + invoke `createHttpServer(server)` from T01; `listen` on `process.env['PORT'] ?? 3000`; log "ProductValidation MCP Server running on HTTP :3000" to stderr.
  - Any other value: stderr error message + `process.exit(1)`.
  Tool/prompt/resource registration (lines 56-106) runs identically in both modes — same `McpServer` instance.

  **Highest-risk regression point** (per R4): the existing Claude Desktop stdio config + the Phase 02 `assert-fomi-run` regression both run through the unset-env-var default path. The refactor must not change the default behavior at all.
- **Files:** `src/index.ts` (refactor lines 108-117 + add import for `createHttpServer`, ~30 lines net change).
- **Spec refs:** §1 anti-bias non-regression; spec §11 DoD (stdio still works); CONTEXT.md Constraints ("Stdio transport must keep working").
- **Acceptance:**
  - With `MCP_TRANSPORT` unset: `node build/index.js` boots stdio mode (stderr log mentions "stdio"). Existing Claude Desktop config + `assert-fomi-run.ts` still work.
  - With `MCP_TRANSPORT=http`: boots HTTP on `:3000` (stderr log mentions "HTTP" + port).
  - With `MCP_TRANSPORT=garbage`: `node build/index.js` exits 1 with a stderr message naming the invalid value.
  - `grep -nE "process\.env\[?['\"]?MCP_TRANSPORT" src/index.ts` returns ≥1 match.
  - **(C5)** **Immediate non-regression catch:** after the T02 commit lands, the executor runs `npx tsx scripts/assert-fomi-run.ts` (default artifact, the Phase 01 captured `01-fomi-focus-app.md`) and confirms **exit code 0**. This catches stdio regressions at T02 rather than deferring to T-final-2 (which is 30+ tasks downstream). Commit message documents the exit code.
- **Dependencies:** T01
- **Complexity:** S

#### T03 — `GET /health` endpoint returning structured status JSON
- **Goal:** Add a `GET /health` route to the Express app in `src/http/server.ts`. Response shape:
  ```json
  {
    "status": "ok" | "degraded",
    "version": "0.1.0",
    "uptime_s": 12345,
    "db_ok": true,
    "transport": "http",
    "checked_at": "<ISO>"
  }
  ```
  `db_ok` returns `false` if the SQLite connection (T05) is unhealthy; before T05 lands, this field can hard-return `true` and be enriched in T22 (deferred). `status` is `"degraded"` if any subsystem fails. Status code is always 200 (Fly's healthcheck wants 2xx for any non-fatal state; logs surface degradation).
- **Files:** `src/http/server.ts` (extend, ~30 lines added).
- **Spec refs:** CONTEXT.md decision 4 (`/health` for Fly healthchecks).
- **Acceptance:**
  - `curl localhost:3000/health` returns HTTP 200 with the JSON shape above.
  - Field `version` reads from `package.json` (no hardcoded duplication).
  - `uptime_s` increases between two back-to-back curls (uses `process.uptime()`).
- **Dependencies:** T01
- **Complexity:** S

#### T04 — Local smoke test: `tools/list` returns all 13 tools via HTTP
- **Goal:** New `scripts/smoke-http.ts` (tsx-runnable) that boots the server in HTTP mode in a child process, waits for `/health` to return 200, then sends a `tools/list` JSON-RPC request to `POST /mcp` (no auth yet — Stream B hasn't landed) and asserts the response lists exactly 13 tools by name. Also runs a sample `tools/call` for `get_category_failure_modes` and asserts the response has the `ToolResult<T>` envelope shape (`data`, `sources`, `confidence_note`, `fallbacks_used`).

  Tool name list to assert against (matches `src/index.ts:86-99` registration order):
  ```
  find_closest_competitor, read_competitor_changelog, map_competitive_weaknesses,
  scan_producthunt_launches, get_category_failure_modes, find_yc_rfs_alignment,
  find_pricing_anchors, check_big_tech_encroachment, find_why_now_signals,
  estimate_demand_signals, find_public_revenue_signals, assess_platform_dependency,
  finalize_validation_report
  ```
- **Files:** `scripts/smoke-http.ts` (new, ~80 lines); `package.json` (add `"smoke:http": "tsx scripts/smoke-http.ts"` script).
- **Spec refs:** §11 DoD ("All 5 prompts callable" — extended to "all 13 tools callable via HTTPS"); §1 anti-bias non-regression (envelope shape preserved end-to-end).
- **Acceptance:**
  - `npm run smoke:http` exits 0.
  - Stdout includes a line `"13 of 13 tools listed via HTTP"` and a line confirming the sample tool response had all 4 envelope fields.
  - Script kills the child server process on completion (no orphaned processes).
- **Dependencies:** T01, T02, T03
- **Complexity:** M

---

### Stream B — Bearer Token Auth (T05–T10)

Sequential because most tasks touch shared DB/auth modules.

#### T05 — SQLite schema + connection wrapper
- **Goal:** Two new files:
  - `src/db/schema.sql` — DDL applied on boot. Tables:
    ```sql
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,  -- sha256(token); never store plaintext after issue
      token_prefix TEXT NOT NULL,        -- first 7 chars (e.g. "pv_a1b2c") — see CONTEXT.md D-03-2
      email TEXT NOT NULL,
      created_at TEXT NOT NULL,          -- ISO timestamp
      last_used_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked'))
    );

    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id INTEGER NOT NULL REFERENCES tokens(id),
      tool_name TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,              -- 'ok' | 'error' | 'rate_limited'
      created_at TEXT NOT NULL           -- ISO timestamp (UTC)
    );
    CREATE INDEX IF NOT EXISTS idx_usage_log_token_created
      ON usage_log(token_id, created_at);

    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,              -- 'global:serper:YYYY-MM-DD'
      count INTEGER NOT NULL DEFAULT 0,
      window_start TEXT NOT NULL         -- ISO timestamp UTC midnight
    );
    ```
  - `src/db/connection.ts` — exports `getDb(): Database.Database` (singleton). On first call:
    1. Open SQLite at `process.env['VETOED_DB_PATH'] ?? '/data/vetoed.db'` (dev fallback: `./vetoed.db`).
    2. `PRAGMA journal_mode = WAL` (per R5 — required for the rate-limit txn pattern).
    3. `PRAGMA foreign_keys = ON`.
    4. Read `schema.sql` from disk + execute via `db.exec(...)` (idempotent via `IF NOT EXISTS`).
    5. Return the singleton.

  Add `better-sqlite3` and `@types/better-sqlite3` to package.json deps.
- **Files:** `src/db/schema.sql` (new); `src/db/connection.ts` (new, ~50 lines); `package.json` (deps).
- **Spec refs:** CONTEXT.md decision 7 (SQLite + `/data/vetoed.db` + IF NOT EXISTS bootstrap).
- **Acceptance:**
  - `npm install` succeeds with `better-sqlite3` added.
  - `getDb()` called twice returns the same instance (singleton).
  - Running once creates the DB file + tables; running again with the file present is a no-op (no schema errors).
  - `PRAGMA journal_mode` returns `wal` in a one-off REPL check.
- **Dependencies:** none (independent of T01–T04 — different file)
- **Complexity:** M

#### T06 — Token issue / validate / revoke functions
- **Goal:** New `src/auth/tokens.ts` exporting:
  - `issueToken(email: string): { id: number; token: string; prefix: string }` — generates `pv_<base64url-32bytes>` (uses `crypto.randomBytes(32).toString('base64url')`), hashes with sha256, stores `{token_hash, token_prefix, email, created_at, status:'active'}`. **`token_prefix` is the first 7 chars (`pv_xxxxx`)** per CONTEXT.md / D-03-2 — grep-friendly because `pv_` is the discriminator. Returns the plaintext token to the caller ONCE (never logged, never readable from DB after this).
  - `validateToken(rawToken: string): { id: number; email: string } | null` — hashes input, looks up by `token_hash`, returns row if `status='active'`, also updates `last_used_at` (single transaction).
  - `revokeToken(idOrPrefix: string | number): boolean` — accepts either numeric id or `pv_<prefix>` prefix; updates `status='revoked'`; returns true if exactly 1 row updated.
  - `listTokens(): Array<{ id: number; email: string; prefix: string; created_at: string; last_used_at: string | null; status: string }>` — for CLI/admin display. Prefix shown is the first-7-char `pv_xxxxx`. **Never returns the plaintext token or the full hash.**

  The `pv_` prefix on issue is **mandatory** (CONTEXT.md Constraints — "Makes leaked tokens grep-able. Not optional.").
- **Files:** `src/auth/tokens.ts` (new, ~100 lines).
- **Spec refs:** CONTEXT.md decision 1 (token format + storage); §1 anti-bias non-regression (auth must not mutate JSON-RPC bodies — pure middleware).
- **Acceptance:**
  - Unit test (T10) confirms: issue → validate roundtrip; issue → revoke → validate returns null.
  - `grep -n "pv_" src/auth/tokens.ts` returns ≥1 match in the token-generation path.
  - `grep -nE "substring\(0,\s*7\)|slice\(0,\s*7\)" src/auth/tokens.ts` returns ≥1 match (locks the first-7 prefix shape).
  - No file in `src/auth/` or `src/db/` ever logs the plaintext token (verified by T10 + manual grep `console\.|logger\.` near token paths).
- **Dependencies:** T05
- **Complexity:** M

#### T07 — Express `authRequired` middleware
- **Goal:** New `src/auth/middleware.ts` exporting `authRequired(req, res, next)`:
  1. Read `Authorization` header. Expected format: `Bearer pv_<token>`.
  2. Missing OR malformed → 401 + `WWW-Authenticate: Bearer realm="vetoed"` header + JSON body `{ error: 'unauthorized', reason: 'missing_or_malformed_authorization_header' }`.
  3. Call `validateToken(rawToken)`. Returns null → 401 with `reason: 'invalid_or_revoked_token'`.
  4. Returns `{id, email}` → attach to `req.tokenId = id` and `req.tokenEmail = email` (declaration-merging `express.Request` in `src/auth/types.ts`); call `next()`.
  5. **Critical:** middleware must NOT consume / replace `req.body`. The Streamable HTTP transport (T01) reads the JSON-RPC body downstream. If `express.json()` was already invoked at the app level, body is already parsed; middleware just reads `req.headers`.

  Wire into `src/http/server.ts`: apply `authRequired` to `POST /mcp` ONLY. `GET /health`, `GET /`, `GET /admin*` use their own middleware (none, none, basic-auth respectively).
- **Files:** `src/auth/middleware.ts` (new, ~50 lines); `src/auth/types.ts` (declaration merge, ~10 lines); `src/http/server.ts` (wire, ~5 lines added).
- **Spec refs:** CONTEXT.md decision 1 (401 + `WWW-Authenticate` shape); §1 anti-bias non-regression (no body mutation).
- **Acceptance:**
  - Unit test (T10) — `curl POST /mcp` without header returns 401 + correct headers.
  - With valid token: middleware passes through, downstream JSON-RPC handler receives body intact.
  - Verified via `grep -n "WWW-Authenticate" src/auth/middleware.ts` returns ≥1 match.
- **Dependencies:** T06, T01
- **Complexity:** M

#### T08 — `WWW-Authenticate: Bearer realm="vetoed"` header on 401
- **Goal:** Confirm and **lock** the exact header string. CONTEXT.md Constraints + Success Criteria both specify `WWW-Authenticate: Bearer realm="vetoed"` verbatim. Add a unit-test-grade assertion in T10 fixture covering the exact-string match. This task exists separately because it's small and easy to regress — the realm string is a public-API contract once users add it to their Claude Desktop configs.
- **Files:** likely zero new — verifies the T07 implementation. If T07 already emits the exact header, this task is a no-op + commit message documenting the verification. If not, this task fixes it.
- **Spec refs:** CONTEXT.md success criteria.
- **Acceptance:**
  - `grep -nF 'Bearer realm="vetoed"' src/auth/middleware.ts` returns exactly 1 match (single source of truth — no duplication).
  - Header tested in T10 with exact-string comparison, not regex.
- **Dependencies:** T07
- **Complexity:** S

#### T09 — Admin CLI: `issue-token`, `list-tokens`, `revoke-token`
- **Goal:** New `scripts/admin.ts` (tsx-runnable), invoked via `npm run admin -- <subcommand> [args]`. Subcommands:
  - `issue-token --email=<email>` → prints the plaintext token ONCE (the only time it's ever visible) + `id` + `prefix`. Exits 1 if email is empty/malformed.
  - `list-tokens` → prints a fixed-width table: `id | prefix | email | created_at | last_used | status`. Tokens shown as first-7-char prefix only (`pv_a1b2c…`); plaintext never re-displayed.
  - `revoke-token <id-or-prefix>` → accepts integer or prefix; prints "revoked id=N" on success or "no match" exit 1 on no rows updated.

  Runs **inside the production container** via `flyctl ssh console -a vetoed-mcp` → `npm run admin -- <subcommand>` (per C3 reconciliation; T16 ships `scripts/` in the runtime image; T24 runbook documents the SSH attach path). Alternative dev workflow (`flyctl proxy` to local DB) is also valid but no longer the canonical path.

  Add to `package.json` scripts: `"admin": "tsx scripts/admin.ts"`.
- **Files:** `scripts/admin.ts` (new, ~120 lines); `package.json` (script).
- **Spec refs:** CONTEXT.md success criteria (3 admin CLI subcommands).
- **Acceptance:**
  - `npm run admin -- issue-token --email=test@example.com` outputs a `pv_<…>` token; the same token appears in DB under `token_prefix` (first 7 chars).
  - `npm run admin -- list-tokens` prints the test token's prefix (NOT the plaintext).
  - `npm run admin -- revoke-token pv_a1b2c` succeeds when the prefix matches exactly one token; subsequent `validateToken` for that token returns null.
- **Dependencies:** T06
- **Complexity:** M

#### T10 — Unit tests for token validation + middleware (happy + 401 paths)
- **Goal:** New `src/auth/tokens.test.ts` + `src/auth/middleware.test.ts` (Vitest, building on Phase 02 T-V01 harness). Cases:
  - `tokens.test.ts`:
    - `issueToken` returns `pv_`-prefixed plaintext + correct first-7-char prefix; row exists with `status='active'`.
    - `validateToken(plaintext)` returns `{id, email}`; updates `last_used_at`.
    - `validateToken('pv_bogus...')` returns null.
    - `revokeToken(id)` → subsequent `validateToken` returns null.
    - `listTokens()` does not return plaintext or hash fields; prefix is exactly 7 chars.
  - `middleware.test.ts` (via `supertest` against a minimal Express app):
    - No header → 401 + `WWW-Authenticate: Bearer realm="vetoed"` (exact-string).
    - Header `Bearer pv_bogus` → 401, body `{ error: 'unauthorized', reason: 'invalid_or_revoked_token' }`.
    - Valid token → 200 from downstream stub handler; `req.tokenId` populated.

  Add `supertest` + `@types/supertest` to devDependencies.
- **Files:** `src/auth/tokens.test.ts` (new, ~80 lines); `src/auth/middleware.test.ts` (new, ~80 lines); `package.json` (devDeps).
- **Spec refs:** CONCERNS.md L1 (test harness extended); CONTEXT.md success criteria.
- **Acceptance:**
  - `npm test` exits 0; new test count is ≥10 assertions (covers both files).
  - At least one assertion uses `.toBe('Bearer realm="vetoed"')` exact-string match.
- **Dependencies:** T07, T08, T09
- **Complexity:** M

---

### Stream C — Rate Limiting (T11–T15)

#### T11 — Per-token rate limiter (20 validate_idea / day → **400 tool calls / day worst case**)
- **Goal:** New `src/ratelimit/per-token.ts` exporting:
  - `checkPerTokenLimit(tokenId: number): { allowed: boolean; remaining: number; retryAfterSec: number }`
  - **Threshold: 400 tool calls / 24h / token.**

  **Math (C6 reconciliation — file-header comment captures this verbatim):**
  ```
  // Per-token rate-limit math:
  //   - User-facing budget: 20 validate_idea runs / day / token (CONTEXT.md decision 2)
  //   - Spec §11 DoD tool-call budget: ≤20 tool calls per validate_idea (UPPER BOUND)
  //   - Worst case per-token tool calls: 20 runs × 20 tool calls = 400 / day
  //   - Typical case: 20 runs × ~13 tool calls ≈ 260 / day
  // We enforce at the tool-call layer (the MCP server cannot observe a "prompt
  // invocation" — prompts are LLM-side orchestration). Threshold = 400 so a user
  // who hits the spec UPPER bound on every run still gets ~20 validations/day.
  // A typical user hitting the threshold has actually run ~30 validate_ideas
  // (400 / 13 ≈ 30), which is well past the 20-run guarantee — they were
  // generous-mode users who deserved the cap. Documented in T20 (HOSTED_SETUP.md).
  ```

  Sliding-window implementation: `SELECT count(*) FROM usage_log WHERE token_id = ? AND created_at > datetime('now', '-1 day') AND status != 'rate_limited'`. If count ≥ 400: `allowed=false`, `retryAfterSec` = seconds until the oldest qualifying row falls out of the window.
- **Files:** `src/ratelimit/per-token.ts` (new, ~80 lines).
- **Spec refs:** CONTEXT.md decision 2 (per-token rate limit); §11 DoD tool budget.
- **Acceptance:**
  - Unit test (T15) confirms threshold fires at exactly the 401st request.
  - Math (260 typical / 400 worst case / 20 runs equivalence) documented in a file-header comment matching the block above.
  - T20 HOSTED_SETUP.md (downstream task) documents the "400 tool calls/day = ~20 runs of validate_idea (typical), 20 runs guaranteed even at spec-max budget" mapping for users.
- **Dependencies:** T05
- **Complexity:** M

#### T12 — Global rate limiter (1,500 Serper calls / day, UTC midnight reset, graceful degradation)
- **Goal:** New `src/ratelimit/global.ts` exporting:
  - `checkGlobalSerperLimit(): { allowed: boolean; remaining: number; retryAfterSec: number }`
  - `recordSerperCall(): void` — increments the counter; called from inside `src/lib/serper.ts` after every successful live Serper invocation. (Stub calls don't count.)
  - Storage: `rate_limits` table with `key = 'global:serper:YYYY-MM-DD'` (UTC date). Read/write done in a transaction (per R5 — single `BEGIN; SELECT count; INSERT-or-update; COMMIT;` to bound the race window).
  - Threshold: **1,500 calls / UTC day**.
  - On exceeded: `allowed=false`; `retryAfterSec` = seconds until next UTC midnight.
  - **Honest-gap surfacing (C7 final disposition):** when global limit hits, `src/lib/serper.ts` MUST behave the same as when the API key is absent — return stub data, push `'serper_global_cap'` to `fallbacksUsed`, downgrade source tier to D / bias unknown. **No 429 is emitted for the global cap.** This preserves spec §11 anti-pattern 2 ("Never fail silently") + §7 graceful degradation. 429 is reserved for the per-token cap (T11/T13). Structured warning log emitted on every cap hit via the pino logger (T21).
- **Files:** `src/ratelimit/global.ts` (new, ~80 lines); `src/lib/serper.ts` (wire `checkGlobalSerperLimit` + `recordSerperCall`, ~15 lines net change).
- **Spec refs:** CONTEXT.md decision 2 (updated v0.2: graceful degradation, NO 429 for global cap); §7 graceful degradation; §11 anti-pattern 2.
- **Acceptance:**
  - Unit test (T15) confirms call 1501 returns `allowed=false`.
  - When global cap fires, `serperSearch` returns stub data with `fallbacks_used` containing **literal string `'serper_global_cap'`**. `grep -nF "'serper_global_cap'" src/lib/serper.ts` returns ≥1 match.
  - The HTTP response for a tool call that hits the global cap is **200** with the standard envelope shape (stub data + `fallbacks_used: ['serper_global_cap']`), NOT a 429. (Verified in T15 test that wires the limiter to a fake serper call.)
  - **R5 race-window doc:** file header comment explicitly states the small race window (2 concurrent requests can both pass the check before either increments — acceptable; could allow 1–2 extra calls per day per CONTEXT.md R5).
- **Dependencies:** T05
- **Complexity:** M

#### T13 — Express `rateLimit` middleware (429 + `Retry-After` for per-token cap)
- **Goal:** New `src/ratelimit/middleware.ts` exporting `rateLimit(req, res, next)`. Order of checks:
  1. `checkPerTokenLimit(req.tokenId)` → if not allowed: 429 + `Retry-After: <sec>` header + JSON body `{ error: 'rate_limited', reason: 'per_token_limit_exceeded', retry_after_sec: N }`. Also log a structured warning via pino (T21).
  2. **(Global Serper limit is enforced INSIDE `src/lib/serper.ts` per T12 — the middleware does NOT pre-check the global limit, because not every tool call uses Serper. Global-cap behavior is graceful degradation, not 429, per C7/CONTEXT.md.)**

  Wire into `src/http/server.ts` `POST /mcp` route, AFTER `authRequired` (T07) and BEFORE the MCP transport handler.
- **Files:** `src/ratelimit/middleware.ts` (new, ~40 lines); `src/http/server.ts` (wire, ~3 lines).
- **Spec refs:** CONTEXT.md success criteria (429 + `Retry-After` on per-token); decision 2.
- **Acceptance:**
  - Unit test (T15): 401st request returns 429 with correct headers + body.
  - `grep -n "Retry-After" src/ratelimit/middleware.ts` returns ≥1 match.
- **Dependencies:** T07, T11
- **Complexity:** S

#### T14 — `usage_log` insertion on every successful tool call
- **Goal:** Add a thin post-handler hook in `src/http/server.ts` (or as a wrapper around the Streamable HTTP transport's tool-call handler — the exact integration point depends on T01's verified API surface). After every `tools/call` JSON-RPC response is sent, insert one row into `usage_log`:
  ```
  { token_id, tool_name, duration_ms, status: 'ok' | 'error', created_at }
  ```
  - `tool_name` extracted from the JSON-RPC request `params.name`.
  - `duration_ms` measured from request receipt to response send.
  - `status='error'` if the response has a JSON-RPC error or HTTP non-2xx.
  - On rate-limited responses (T13), `status='rate_limited'` — but this is recorded BEFORE the per-token-limit check so the rate-limit denial itself doesn't count toward the next window (per T11 sliding-window SQL: `WHERE status != 'rate_limited'`).

  This task is the source of truth for `usage_log`; per-token rate limiter (T11) and admin usage view (T28) both read it.
- **Files:** `src/http/server.ts` (extend, ~30 lines); possibly a small new helper `src/http/usage-logger.ts`.
- **Spec refs:** CONTEXT.md decision 2 + 8 (`usage_log` tracking + structured logs).
- **Acceptance:**
  - After issuing a token and firing 3 `tools/call` requests via curl, `SELECT count(*) FROM usage_log WHERE token_id = ?` returns 3.
  - `duration_ms` is non-negative for every row.
  - Failed JSON-RPC calls insert a row with `status='error'`.
- **Dependencies:** T01, T07, T11
- **Complexity:** M

#### T15 — Rate-limit tests: thresholds + 429 headers + global-cap graceful degradation
- **Goal:** New `src/ratelimit/per-token.test.ts` + `src/ratelimit/global.test.ts`. Cases:
  - Per-token: seed `usage_log` with 399 rows for a token, dated within the last 24h. Request 400 → `allowed=true, remaining=0`. Request 401 → `allowed=false, retryAfterSec > 0`.
  - Per-token: seed `usage_log` with 500 rows BUT dated >24h ago. Request 1 → `allowed=true` (sliding window correctly excludes stale rows).
  - Global: seed `rate_limits` with `count=1499` for today's UTC date. `recordSerperCall(); checkGlobalSerperLimit()` returns `allowed=false`.
  - Global: across UTC midnight (use `vi.useFakeTimers()` to advance clock), counter resets via the new-key lookup.
  - **(C7)** **Global-cap graceful-degradation test:** with `count=1500`, a call to `serperSearch(...)` returns the stub-shape envelope with `fallbacks_used` containing `'serper_global_cap'` and **does NOT throw / does NOT return a 429**. This locks the graceful-degradation contract.
  - Middleware (via supertest): 401st request returns 429 + `Retry-After` header + JSON body shape from T13.
- **Files:** `src/ratelimit/per-token.test.ts` (new, ~80 lines); `src/ratelimit/global.test.ts` (new, ~80 lines).
- **Spec refs:** CONTEXT.md success criteria.
- **Acceptance:**
  - `npm test` exits 0; ≥12 new assertions across the two files (includes the new graceful-degradation test).
  - Test for the sliding-window-excludes-stale-rows case is explicitly present (locks the SQL `WHERE created_at > datetime('now', '-1 day')` behavior).
- **Dependencies:** T11, T12, T13
- **Complexity:** M

---

### Stream D — Deployment (T16–T20)

#### T16 — Dockerfile (Node 22, multi-stage, **includes `scripts/`** for in-container admin CLI)
- **Goal:** New `Dockerfile` at repo root. Multi-stage:
  1. `FROM node:22-bookworm-slim AS builder` — `WORKDIR /app`, copy `package*.json`, `npm ci`, copy `src/` + `tsconfig.json`, `npm run build`.
  2. `FROM node:22-bookworm-slim AS runtime` — `WORKDIR /app`, copy `package*.json` + `build/` + `src/resources/` + `src/db/schema.sql` (needed at runtime by T05's connection) + `public/` (for T26 static serving) + **`scripts/`** (per C3 reconciliation — the admin CLI ships in the container so `flyctl ssh console` → `npm run admin -- <subcommand>` works). Install runtime deps with `npm ci --omit=dev`, but keep `tsx` as a runtime dep (or move from devDeps to deps in package.json) so `npm run admin` can execute the TS source. ENV `NODE_ENV=production`, `MCP_TRANSPORT=http`, `PORT=3000`. `EXPOSE 3000`. `CMD ["node", "build/index.js"]`.

  Add `.dockerignore` excluding `.planning/`, `.git/`, `node_modules/`, `build/`, `*.test.ts`, `vitest.config.ts`. **Do NOT exclude `scripts/`** — it is required for the admin runbook.

  **better-sqlite3 native module note:** uses prebuilt binaries; should work out of the box on `node:22-bookworm-slim`. If native build fails in CI, T16's commit message documents the workaround (e.g., add `build-essential python3` to the builder stage).
- **Files:** `Dockerfile` (new, ~35 lines); `.dockerignore` (new, ~12 lines); `package.json` (move `tsx` to deps if currently in devDeps).
- **Spec refs:** CONTEXT.md decision 3 (Fly.io hosting); C3 (T16 ↔ T24 reconciliation).
- **Acceptance:**
  - `docker build -t vetoed-mcp .` succeeds locally.
  - `docker run --rm -p 3000:3000 -e MCP_TRANSPORT=http vetoed-mcp` boots; `curl localhost:3000/health` returns 200.
  - `docker run --rm vetoed-mcp ls scripts/admin.ts` succeeds (the admin CLI is present in the image).
  - `docker run --rm -e VETOED_DB_PATH=/tmp/test.db vetoed-mcp npm run admin -- list-tokens` exits 0 (CLI invokable from within the container — proves the runbook path works).
  - Image size <500MB (sanity check via `docker images vetoed-mcp`).
- **Dependencies:** T02, T03, T09 (need HTTP boot path + health endpoint + admin CLI to ship in the image)
- **Complexity:** M

#### T17 — `fly.toml` configuration + volume-create prereq documented
- **Goal:** New `fly.toml` at repo root. Contents:
  - `app = "vetoed-mcp"` (per OQ4 — final app name confirmed in this commit; if Aljosa renames, update in same commit + `docs/DNS_SETUP.md` CNAME target).
  - `primary_region = "iad"` (per CONTEXT.md "One region to start (probably IAD or LHR)").
  - `[build]` section pointing to the local `Dockerfile`.
  - `[env]` section with `MCP_TRANSPORT = "http"`, `PORT = "3000"`, `VETOED_DB_PATH = "/data/vetoed.db"`.
  - `[[services]]` block: internal port 3000, https handler with auto Let's Encrypt; `force_https = true`.
  - `[[services.tcp_checks]]` and `[[services.http_checks]]` — health check `GET /health` every 15s.
  - `[mounts]` (PER R2 — REQUIRED for SQLite persistence): `source = "vetoed_data"`, `destination = "/data"`. The volume is referenced **by name**; the volume itself MUST be created out-of-band before first deploy.
  - `[deploy]` strategy `rolling`.

  Secrets referenced (set via `flyctl secrets set` per CONTEXT.md decision 8 + T24 runbook):
  - `SERPER_API_KEY`
  - `PRODUCTHUNT_API_KEY`
  - `GITHUB_TOKEN`
  - `ADMIN_PASSWORD`

  These are NOT included in `fly.toml`; only referenced by name in this task's commit message + T24 runbook.
- **Files:** `fly.toml` (new, ~50 lines).
- **Spec refs:** CONTEXT.md decision 3 + 8.
- **Acceptance:**
  - `flyctl config validate fly.toml` exits 0 (or the equivalent dry-run command — user runs this locally; CI doesn't need flyctl).
  - File contains exactly ONE `[mounts]` block with `destination = "/data"`.
  - `grep -nE "SERPER_API_KEY|ADMIN_PASSWORD" fly.toml` returns ZERO matches (secrets are not in the toml).
  - **(C4)** T17 commit message body documents the one-time volume-create prereq verbatim:
    ```
    Prereq (one-time, BEFORE first `flyctl deploy`):

        flyctl volumes create vetoed_data --size 1 --region iad

    The [[mounts]] block references this volume by name. If the volume doesn't
    exist at deploy time, Fly's mount step fails and tokens vanish on every
    restart (SQLite writes go to ephemeral storage). This step is also
    captured in docs/OPERATIONS.md (T24).
    ```
  - **(C4)** `docs/OPERATIONS.md` (created in T23 / extended in T24) MUST contain the `flyctl volumes create vetoed_data --size 1 --region iad` command in a clearly-labeled "First-time deploy prereq" section. (T24 acceptance separately enforces this — cross-referenced here.)
  - **(OQ4)** App name `vetoed-mcp` confirmed in this commit; if Aljosa changes pre-deploy, `fly.toml` + `docs/DNS_SETUP.md` updated in the same commit.
- **Dependencies:** T16
- **Complexity:** M

#### T18 — GitHub Actions deploy workflow
- **Goal:** New `.github/workflows/deploy.yml`. On push to `main`:
  1. Checkout.
  2. Setup Node 22.
  3. `npm ci`.
  4. `npm test` (must pass — this gates deploy on the Vitest suite from Phase 02 + new Phase 03 tests).
  5. `npm run build`.
  6. Install flyctl: `curl -L https://fly.io/install.sh | sh`.
  7. `flyctl deploy --remote-only` using `FLY_API_TOKEN` from `${{ secrets.FLY_API_TOKEN }}`.

  Job also includes `permissions: contents: read` only (least-privilege).
- **Files:** `.github/workflows/deploy.yml` (new, ~40 lines).
- **Spec refs:** CONTEXT.md decision 3.
- **Acceptance:**
  - Workflow file lints (no syntax errors).
  - Workflow uses `${{ secrets.FLY_API_TOKEN }}` exactly once; commit message documents the user-action requirements: (1) add `FLY_API_TOKEN` secret in GitHub repo settings; (2) run `flyctl volumes create vetoed_data --size 1 --region iad` once before first deploy (per T17 / C4).
  - Test step (`npm test`) is BEFORE the deploy step — failed tests block deploy.
- **Dependencies:** T16, T17
- **Complexity:** S

#### T19 — DNS configuration documentation
- **Goal:** New section in `docs/HOSTED_SETUP.md` (file created by T20) OR a standalone `docs/DNS_SETUP.md` — planner picks **standalone DNS doc** to keep the user-facing onboarding doc (T20) focused on Claude-Desktop config only.

  `docs/DNS_SETUP.md` covers:
  - One-time setup: at the user's registrar, add a CNAME record: `getvetoed.com` → `vetoed-mcp.fly.dev` (or the actual Fly app name from `fly.toml` if changed).
  - Apex-domain note: if registrar doesn't support CNAME-at-apex, use ALIAS / ANAME / flattening; Cloudflare and most modern registrars support this.
  - Verification: `dig getvetoed.com CNAME` should show the Fly target; `curl -v https://getvetoed.com/health` should return 200 with a Let's Encrypt cert.
  - Propagation note (per R3): 15min–24h propagation; T-final-3b's fallback to `<app>.fly.dev/mcp` is explicit (per OQ2).
  - Fly cert provisioning: `flyctl certs add getvetoed.com` after DNS is in place.
- **Files:** `docs/DNS_SETUP.md` (new, ~50 lines).
- **Spec refs:** CONTEXT.md decision 4 (domain = getvetoed.com); OQ2.
- **Acceptance:**
  - File exists; covers CNAME / apex / verification / propagation / cert / fallback.
  - `grep -F 'flyctl certs add getvetoed.com' docs/DNS_SETUP.md` returns ≥1 match.
- **Dependencies:** T17
- **Complexity:** S

#### T20 — User onboarding doc `docs/HOSTED_SETUP.md`
- **Goal:** New `docs/HOSTED_SETUP.md` documenting how a user (non-Aljosa) adds the hosted MCP to Claude Desktop. Sections:
  1. **Get a token** — email aljosa@getvetoed.com requesting access; receive a `pv_<…>` token.
  2. **Add to Claude Desktop config** — exact JSON snippet for `~/Library/Application Support/Claude/claude_desktop_config.json` showing the Streamable HTTP transport config with `url: "https://getvetoed.com/mcp"` and `headers: { "Authorization": "Bearer pv_..." }`. (Use the SDK API surface verified in T01.)
  3. **Verify it works** — restart Claude Desktop, run `validate_idea` on a test idea; should return a structured report. Troubleshooting for 401 (token typo), 429 (hit rate limit), 500 (server error — email Aljosa).
  4. **Rate limits** — explicit mapping per C6: "400 tool calls / day / token. A typical `validate_idea` run fires ~13 tool calls, so you get ~30 typical runs / day. A run hitting the spec UPPER bound of 20 tool calls gets you exactly 20 runs / day guaranteed. Global cap: 1,500 Serper calls / day across all users — if hit, some tool responses gracefully degrade to stub data (you'll see `fallbacks_used: ['serper_global_cap']` in the response envelope)."
  5. **Stdio fallback** — for power users, document the local-stdio config option (current behavior, unchanged).
- **Files:** `docs/HOSTED_SETUP.md` (new, ~120 lines).
- **Spec refs:** CONTEXT.md success criteria; C6 (rate-limit mapping documented).
- **Acceptance:**
  - Doc exists with all 5 sections.
  - The Claude Desktop config JSON snippet is copy-pasteable (valid JSON).
  - Section 4 contains the explicit phrase "400 tool calls / day / token" (locks the C6 disposition into user-facing docs).
- **Dependencies:** T19 (DNS doc referenced); T01 (transport config shape verified); T11 (rate-limit math)
- **Complexity:** S

---

### Stream E — Observability + Safety (T21–T24)

Mostly docs / wiring; can run in parallel with Streams B/C/F once the Express app exists (T01).

#### T21 — pino logger setup with redaction
- **Goal:** New `src/lib/logger.ts` exporting a configured pino instance:
  - Output: JSON to stdout (Fly captures stdout into the log stream — note this is fine for HTTP mode; stdio mode keeps using `console.error` for transport-safe stderr-only logs).
  - Redact list (per CONTEXT.md decision 8 + R6 admin-password leakage):
    - `SERPER_API_KEY`, `PRODUCTHUNT_API_KEY`, `GITHUB_TOKEN`, `ADMIN_PASSWORD` (substring matches across log payloads).
    - `*.authorization` (any nested key named `authorization` — the Bearer token).
    - `*.token`, `*.token_hash`, `*.password`.
    - Request body truncated to 200 chars (pino's `redact.paths` + a custom serializer).
  - Levels: `info` default; `warn` for rate limits + global-cap hits; `error` for crashes.
  - Wire into `src/http/server.ts` (HTTP path only; stdio path stays on `console.error`).
- **Files:** `src/lib/logger.ts` (new, ~60 lines); `src/http/server.ts` (use logger, ~10 lines); `package.json` (add `pino`).
- **Spec refs:** CONTEXT.md decision 8 + R6.
- **Acceptance:**
  - Smoke test: log an object containing `{ authorization: 'Bearer pv_secret123', body: 'x'.repeat(500) }` → output shows `[Redacted]` for `authorization` and a truncated body.
  - **R6 password leakage smoke test:** `ADMIN_PASSWORD=hunter2 npm run smoke:http` followed by `grep -F 'hunter2' <captured-log-stdout>` returns ZERO matches.
- **Dependencies:** T01
- **Complexity:** M

#### T22 — Enrich `/health` with DB + cache + last-error timestamp
- **Goal:** Extend the `GET /health` handler from T03 to include:
  - `db_ok: boolean` — runs `SELECT 1` against SQLite; false if it throws.
  - `last_error_at: string | null` — last error timestamp from a small in-memory ring buffer (capacity 1) updated by `logger.error` calls. Resets to null on boot.
  - `cache_hit_rate: number | null` — exposes `cacheStats()` from `src/lib/cache.ts` if available; null if not instrumented yet (cache hit-rate instrumentation can be deferred — Phase 04 candidate).
- **Files:** `src/http/server.ts` (extend health handler, ~25 lines).
- **Spec refs:** CONTEXT.md decision 4 + Stream E success criterion.
- **Acceptance:**
  - `curl localhost:3000/health` includes the three new fields.
  - When the DB connection is broken (force by setting `VETOED_DB_PATH` to an unwritable path), `db_ok` is false and HTTP status is still 200 (Fly healthcheck per T03 design).
- **Dependencies:** T03, T05, T21
- **Complexity:** S

#### T23 — Fly metrics dashboard docs + first-time deploy prereqs
- **Goal:** Create `docs/OPERATIONS.md` with sections:
  - **First-time deploy prereqs** (per C4): the `flyctl volumes create vetoed_data --size 1 --region iad` step (one-time, before first `flyctl deploy`). Also: `FLY_API_TOKEN` GitHub secret setup (one-time). Also: `flyctl certs add getvetoed.com` after DNS resolves.
  - **Fly metrics dashboard** — link to `https://fly.io/apps/vetoed-mcp/metrics`; brief description of CPU / memory / RPS / response time graphs (built-in).
  - **Custom metrics deferred** — Phase 04 candidate.
  - **Log inspection** — `flyctl logs` and how to grep for `pv_` (leaked tokens) or `rate_limited` (capacity signal) or `serper_global_cap` (global-cap hits).
- **Files:** `docs/OPERATIONS.md` (new, ~70 lines).
- **Spec refs:** CONTEXT.md decision 8 (Stream E observability); C4 (volume-create prereq surfaced in OPERATIONS.md).
- **Acceptance:**
  - File exists with the 4 sections; commands are copy-pasteable.
  - `grep -F 'flyctl volumes create vetoed_data' docs/OPERATIONS.md` returns ≥1 match (C4 prereq surfaced).
  - First-time-prereqs section appears BEFORE the metrics section (operationally first thing a reader needs).
- **Dependencies:** T17
- **Complexity:** S

#### T24 — Secrets rotation + admin runbook (in-container path)
- **Goal:** Append to `docs/OPERATIONS.md` (from T23) a runbook covering:
  - **Secrets rotation:** `flyctl secrets set SERPER_API_KEY=<new-key>` — restarts the app. Same shape for `PRODUCTHUNT_API_KEY`, `GITHUB_TOKEN`, `ADMIN_PASSWORD`.
  - **(C3) Admin CLI runbook:** the canonical path is **`flyctl ssh console -a vetoed-mcp`** → from inside the container, `cd /app && npm run admin -- <subcommand>` (e.g., `npm run admin -- list-tokens`, `npm run admin -- revoke-token pv_a1b2c`). Per T16, `scripts/` ships in the runtime image so this works out of the box. No localhost-proxy workaround needed.
  - **Alternative admin path** (advanced; only used if `flyctl ssh console` is unavailable): `flyctl proxy` from Aljosa's laptop to the production DB, then `npm run admin` locally pointing at the proxied DB. Documented as a fallback only.
  - **Token revocation:** a token leak is handled via the admin CLI's `revoke-token` subcommand from inside the container; no secret rotation needed.
  - **Verify rotation:** `curl https://getvetoed.com/health` returns 200 after restart.
- **Files:** `docs/OPERATIONS.md` (append, ~50 lines).
- **Spec refs:** CONTEXT.md decision 8; Stream E success criterion; C3 (T16↔T24 reconciliation).
- **Acceptance:**
  - File contains exactly 4 `flyctl secrets set` commands (one per secret listed above).
  - **(C3)** File documents `flyctl ssh console -a vetoed-mcp` → `npm run admin -- <subcommand>` as the canonical admin path. `grep -F 'flyctl ssh console -a vetoed-mcp' docs/OPERATIONS.md` returns ≥1 match.
  - Token-revocation runbook references T09's CLI.
- **Dependencies:** T17, T23, T09, T16
- **Complexity:** S

---

### Stream F — Marketing Landing + Admin Dashboard (T25–T29)

#### T25 — Static landing page `public/index.html`
- **Goal:** New `public/index.html` — single-file static HTML with inline CSS (no build step, no framework). Sections per CONTEXT.md decision 4 + R7:
  - Hero: H1 "Vetoed — kill bad product ideas before you build them" + 1-sentence tagline.
  - "How it works" — 5 condensed gates (Direct Competitor / Market Structure / Platform Risk / Willingness to Pay / Why Now), one paragraph each. Pull verbatim from `.planning/spec/build-spec-v1.0.md` §3 (no rewriting — keep the framework grounded in source).
  - "Who it's for" — solopreneurs + small builder teams + funded founders pre-PRD.
  - Social proof slot — placeholder div `<section id="social-proof">` with comment `<!-- TODO: testimonials once 5 users have shipped a verdict -->`.
  - CTA — `<a href="mailto:aljosa@getvetoed.com?subject=Vetoed%20access%20request">Request access</a>`. **(OQ5)** Placeholder email is `aljosa@getvetoed.com`; Aljosa configures DNS + mailbox on `getvetoed.com` before T25 ships. If unavailable at T25 commit time, fall back to Aljosa's personal email and file a Phase 04 deferred for the rebrand.
  - Footer: link to GitHub repo + spec.

  **Per R7:** copy is minimum-viable. Acceptance is "renders cleanly, no broken layout"; not "marketing-team approved." Aljosa iterates without code change since it's static HTML.
- **Files:** `public/index.html` (new, ~150 lines including inline CSS).
- **Spec refs:** CONTEXT.md decision 4 (Stream F1); OQ5.
- **Acceptance:**
  - File exists; opens in a browser without console errors.
  - HTML validates via `npx html-validate public/index.html` exit 0.
  - `grep -F 'href=""' public/index.html` returns ZERO matches (no broken anchor hrefs).
  - mailto CTA is present.
  - **(OQ5)** No `example.com` references survive in `public/index.html` (`grep -F 'example.com' public/index.html` returns ZERO matches). Aljosa confirms the intake mailbox (`aljosa@getvetoed.com`) is configured before this task commits; if not configured by commit time, the placeholder is the personal address and a Phase 04 D-XX is filed.
- **Dependencies:** none
- **Complexity:** M

#### T26 — Express static-file middleware for `public/`
- **Goal:** Wire `app.use(express.static('public'))` into `src/http/server.ts`. Mount order matters:
  - `GET /health` (T03) — first.
  - `GET /admin*` + admin API (T27, T28) — second.
  - `POST /mcp` (T01 + T07 auth) — third.
  - `app.use(express.static(...))` — LAST (so it doesn't shadow any route).
- **Files:** `src/http/server.ts` (extend, ~5 lines).
- **Spec refs:** CONTEXT.md decision 4 (Stream F2).
- **Acceptance:**
  - `curl localhost:3000/` returns the landing page HTML with `Content-Type: text/html`.
  - `curl localhost:3000/mcp` STILL returns 401 (auth not bypassed by static middleware).
  - `curl localhost:3000/health` STILL returns the health JSON.
- **Dependencies:** T01, T25
- **Complexity:** S

#### T27 — Admin dashboard HTML + basic-auth middleware (fail-closed + constant-time)
- **Goal:** Two pieces:
  - `public/admin/index.html` — static HTML page with inline CSS + minimal vanilla JS placeholder. Sections: token list table (filled by T29 JS), issue-token form, recent usage table.
  - `src/auth/admin-middleware.ts` — `adminAuthRequired(req, res, next)` middleware implementing the following contract:

    **Step 1: Fail-closed on unset/short password (C1).** At the TOP of the middleware, read `process.env['ADMIN_PASSWORD']`. If the value is `undefined`, empty string, or shorter than 12 characters, IMMEDIATELY return **HTTP 500** with JSON body `{ error: 'admin_disabled', message: 'ADMIN_PASSWORD not configured' }`. **Do NOT return 401.** Do NOT log the password value (only log the absence/length-violation as a single warn event). This prevents the silent-allow failure mode where an unset env var would otherwise let anyone in by matching empty string.

    **Step 2: Parse Basic auth.** Read `Authorization: Basic <base64>`. Decode to UTF-8 string `user:pass`. If missing/malformed → 401 + `WWW-Authenticate: Basic realm="vetoed-admin"`.

    **Step 3: Constant-time comparison over FULL `user:pass` (C2).** Construct the expected payload as a `Buffer`: `Buffer.from(\`${ADMIN_USERNAME}:${process.env['ADMIN_PASSWORD']}\`, 'utf8')`. `ADMIN_USERNAME` defaults to `"admin"` and is overridable via `process.env['ADMIN_USERNAME']`. The supplied payload is `Buffer.from(decodedAuth, 'utf8')`. Pad the shorter buffer to equal length (with a fixed sentinel byte) before calling `crypto.timingSafeEqual(supplied, expected)`. The single comparison covers BOTH username and password — no separate username equality check. **Forbid `===` or `==` comparison on any credential string anywhere in this file.**

    **Step 4: On mismatch → 401 + `WWW-Authenticate: Basic realm="vetoed-admin"`. On match → `next()`.**

  Wire into `src/http/server.ts`: `app.use('/admin', adminAuthRequired)` and `app.use('/admin', express.static('public/admin'))` for the HTML; `/admin/api/*` routes (T28) reuse the same middleware.

  **R6 password leakage:** middleware MUST NOT log the password or the full Authorization header. T21 redact list already covers `*.authorization` but verify with a smoke test (commit message documents the check).
- **Files:** `public/admin/index.html` (new, ~100 lines); `src/auth/admin-middleware.ts` (new, ~60 lines); `src/http/server.ts` (wire, ~3 lines).
- **Spec refs:** CONTEXT.md decision 4 (Stream F3) + R6; C1 (fail-closed); C2 (timing-safe over full `user:pass`).
- **Acceptance:**
  - **(C1) Fail-closed acceptance test:** start the server WITHOUT `ADMIN_PASSWORD` set (or with `ADMIN_PASSWORD=""`, or with `ADMIN_PASSWORD=short`); `curl -i localhost:3000/admin/` returns **HTTP 500** with body `{ error: 'admin_disabled', message: 'ADMIN_PASSWORD not configured' }`. **Explicitly NOT 200, explicitly NOT 401.** This is a transport-layer smoke checked by hand AND by a unit test (added in this task) using supertest. Per C1, this is the load-bearing test against the silent-allow failure mode.
  - **(C2) Constant-time-comparison code review:** code review confirms exactly ONE credential-comparison site in `src/auth/admin-middleware.ts`, and that it uses `crypto.timingSafeEqual` over equal-length Buffers built from `Buffer.from('user:pass', 'utf8')`. `grep -nE "===|==" src/auth/admin-middleware.ts | grep -v '// '` returns ZERO matches involving credential variables. `grep -n "timingSafeEqual" src/auth/admin-middleware.ts` returns exactly 1 match.
  - With a valid `ADMIN_PASSWORD=hunter2hunter2` set: `curl localhost:3000/admin/` returns 401 + `WWW-Authenticate: Basic realm="vetoed-admin"`.
  - With the same env var set: `curl -u admin:hunter2hunter2 localhost:3000/admin/` returns the dashboard HTML.
  - With `ADMIN_PASSWORD=hunter2hunter2` AND `ADMIN_USERNAME=alice` and request `-u alice:hunter2hunter2`: returns the dashboard. (Locks the `ADMIN_USERNAME` override path.)
  - Smoke test (per R6): `ADMIN_PASSWORD=hunter2hunter2 npm run smoke:http` → grep stdout/log for `hunter2hunter2` returns ZERO matches.
- **Dependencies:** T26, T21
- **Complexity:** M

#### T28 — Admin API endpoints
- **Goal:** New `src/http/admin-api.ts` exporting `registerAdminApi(app, db)`. Endpoints (all gated by T27 middleware):
  - `GET /admin/api/tokens` — returns `listTokens()` (T06) as JSON.
  - `POST /admin/api/tokens` — body `{ email: string }` → calls `issueToken(email)`; returns `{ id, token, prefix }` (plaintext token included exactly once — admin needs to copy it). Validation: 400 if email missing/empty.
  - `DELETE /admin/api/tokens/:id` — calls `revokeToken(id)`; returns `{ revoked: true }` or 404 if no match.
  - `GET /admin/api/usage` — returns the last 100 `usage_log` rows joined to `tokens.email`, grouped by `token_id`, ordered by `created_at DESC`. Shape: `[{ token_id, email, tool_name, status, duration_ms, created_at }, ...]`.

  Wire `registerAdminApi(app, db)` from `src/http/server.ts` AFTER `adminAuthRequired` is applied to `/admin`.
- **Files:** `src/http/admin-api.ts` (new, ~120 lines); `src/http/server.ts` (wire, ~3 lines).
- **Spec refs:** CONTEXT.md decision 4 (Stream F4).
- **Acceptance:**
  - All 4 endpoints respond correctly when authenticated (covered by manual curl smoke + a follow-up test in T-final-4).
  - Unauthenticated → 401 (T27 middleware applies) OR 500 if `ADMIN_PASSWORD` unset (per C1).
  - `POST /admin/api/tokens` with missing email → 400.
  - `DELETE /admin/api/tokens/9999` (non-existent) → 404.
- **Dependencies:** T27, T06, T14
- **Complexity:** M

#### T29 — Vanilla JS in admin HTML — wire API calls + render tables
- **Goal:** Extend `public/admin/index.html` with `<script>` block (vanilla JS, no framework). On page load:
  - `fetch('/admin/api/tokens', { credentials: 'include' })` (Basic auth credentials carried by browser) → render rows.
  - Issue-token form `<form>` posts to `/admin/api/tokens` → on success, displays the plaintext token in a one-time modal (with a copy button + "remember to save this — won't show again" warning). Then re-fetches token list.
  - Revoke buttons in the table call `DELETE /admin/api/tokens/:id` → on success, re-fetches list.
  - Usage section: `fetch('/admin/api/usage')` → render table grouped by token email.
- **Files:** `public/admin/index.html` (extend, ~100 lines added in `<script>` block).
- **Spec refs:** CONTEXT.md decision 4 (Stream F4 — "vanilla JS in admin HTML that calls the API + renders tables. No framework.").
- **Acceptance:**
  - Manual smoke (T-final-4 includes a checklist item — back-referenced here): log into `/admin/` with correct password → tokens table populates → issue a token → token appears in list → revoke it → status flips to `revoked`. T-final-4's `[✓] authenticated GET /admin/api/tokens returns the test token issued in T-final-3a/3b` is the load-bearing assert.
- **Dependencies:** T27, T28
- **Complexity:** M

---

### Stream G — Calibration Regression via HTTPS (T-final-1 → T-final-4)

Final wave. All previous tasks land first; this stream proves the deployment didn't regress anything.

#### T-final-1 — CONCERNS.md update with Phase 03 closure notes (incl. v0.2 D-XX entries)
- **Goal:** Update `.planning/codebase/CONCERNS.md`:
  - No Phase 03 RESOLVED entries expected (Phase 03 touched the transport layer, not the issue list — Phase 02's M-items remain as RESOLVED from that phase).
  - Add **v0.2-mandatory** D-XX entries:
    - **D-03-1** (Cache hit-rate instrumentation deferred): T22 `cache_hit_rate` returns null; Phase 04 candidate to instrument `src/lib/cache.ts` with hit/miss counters.
    - **D-03-1-a** *(per C7 disposition)*: Global Serper cap implemented as graceful degradation at the `src/lib/serper.ts` layer (NOT a 429 from the HTTP layer). CONTEXT.md (v0.2) success criterion updated to match. Revisit if user feedback indicates a 429-style global cap is preferred for observability — would require admin/serper-status surface.
    - **D-03-2** *(per C8 disposition)*: Token prefix stored as **first 7 chars (`pv_xxxxx`)** for grep-friendliness. CONTEXT.md (v0.2) updated from "last 4 chars only" → "first 7 chars". No code-level migration needed since no tokens were issued pre-v0.2.
    - **D-03-3** (single-region deploy): multi-region deferred until latency complaints emerge (per CONTEXT.md decision 3).
    - **D-03-4** (tool-call-level vs prompt-level rate limit): T11 file-header comment documents the decision; threshold 400 calls/day = 20 spec-max runs/day or ~30 typical runs/day. Revisit if user feedback shows the threshold maps awkwardly.
    - **D-03-5** (self-serve email-collection form vs mailto CTA): mailto for v1; Phase 04 candidate per CONTEXT.md out-of-scope.
    - **D-03-6** *(per OQ3)*: `bin.weather` in `package.json` is a Phase 00 scaffold leftover. Deferred to Phase 04 cleanup; Claude Desktop configs use paths directly, not the bin name, so it's not blocking.
  - Confirm Phase 01 + 02 RESOLVED entries are untouched.
  - Branch nomenclature note (per CONTEXT.md success criteria): "Phase 03 shipped from `phase-v3` → `main`. Future phases use `phase-vN`."
- **Files:** `.planning/codebase/CONCERNS.md`; `.planning/phases/03-multitenant-https/deferred-items.md` (new — mirrors Phase 01/02 deferred-items.md pattern; lists D-03-1 through D-03-6).
- **Spec refs:** none (planning hygiene); C7, C8, OQ3.
- **Acceptance:**
  - File updated with the branch-nomenclature note + the 6 mandatory D-03-XX entries above + any additional D-03-X entries that surfaced during execution.
  - `grep -E "D-03-(1|1-a|2|3|4|5|6)" .planning/codebase/CONCERNS.md` returns ≥6 matches.
- **Dependencies:** T01–T29 (everything must ship before bookkeeping)
- **Complexity:** S

#### T-final-2 — Pre-flight: `assert-fomi-run.ts` against captured Phase-02 artifact still exits 0
- **Goal:** Re-run `npx tsx scripts/assert-fomi-run.ts --artifact .planning/validation-runs/02-fomi-regression-after-phase-02.md` (or the Phase 01 artifact at `01-fomi-focus-app.md` if Phase 02's artifact isn't yet captured at this point — adjust per actual file presence). This verifies that Phase 03's transport/auth/rate-limit/DB code changes did not break the validator pipeline's interpretation of historical artifacts.

  Per R4 (highest-risk regression — refactoring `src/index.ts`): this is a CHEAP pre-flight that catches structural breaks before paying the LLM cost of T-final-3a/3b. Note: T02 already runs this same check immediately post-commit (per C5), so T-final-2 is the second-line gate — but it catches accumulated drift from any of T03–T29.

  If assertion fails: STOP. Investigate which assertion regressed; most likely cause is T02's `src/index.ts` refactor accidentally changing tool/prompt/resource registration order or shape. Fix at root, do NOT modify the validator or `assert-fomi-run.ts` to make it pass.
- **Files:** none (just runs the existing script).
- **Spec refs:** §10 Phase 4 Critical Test (structural validity arm); CONTEXT.md Constraints ("No regression on the Critical Test").
- **Acceptance:**
  - `scripts/assert-fomi-run.ts` exits 0 (6/6 PASS) against the chosen captured artifact.
  - Output captured in commit message.
- **Dependencies:** T-final-1
- **Complexity:** S

#### T-final-3a — Build HTTPS client script (placeholder-URL smoke)
- **Goal:** New `scripts/run-fomi-via-https.ts` (built as part of this task — small additive change, ~80 lines): connects to an arbitrary HTTPS MCP endpoint via Streamable HTTP, authenticates with a bearer token from `--token` or `$VETOED_TEST_TOKEN`, sends the `validate_idea` prompt with the Fomi inputs verbatim from Phase 01/02 artifact frontmatter, captures the full JSON-RPC exchange (tool calls + final `finalize_validation_report` markdown output) to stdout.

  CLI flags:
  - `--endpoint <url>` (default `https://getvetoed.com/mcp`)
  - `--token <bearer>` (or env `VETOED_TEST_TOKEN`)
  - `--idea <text>` (default Fomi case from Phase 01/02 artifact frontmatter)
  - `--out <path>` (default stdout)

  **(C9) Acceptance scope for T-final-3a:** script exists, type-checks, can be invoked with `--endpoint https://example.invalid/mcp --token pv_placeholder --idea 'smoke'` against a placeholder URL **without crashing on startup** (network errors after handshake are expected and don't fail this task). This task does NOT capture the production artifact; T-final-3b does.

  Per R8 + R1, the script's transport client should use the same `@modelcontextprotocol/sdk` Streamable HTTP client pattern verified in T00/T01.
- **Files:** `scripts/run-fomi-via-https.ts` (new, ~80 lines); `package.json` (optional script alias `"fomi:https": "tsx scripts/run-fomi-via-https.ts"`).
- **Spec refs:** §10 Phase 4 Critical Test; §11 DoD; CONTEXT.md success criteria; C9 (split rationale).
- **Acceptance:**
  - File exists and `npx tsx scripts/run-fomi-via-https.ts --help` (or equivalent CLI parse) exits 0 with usage text.
  - **Placeholder smoke:** invoking with `--endpoint https://127.0.0.1:1/mcp --token pv_placeholder` exits with a connection-error message (NOT a crash / NOT an unhandled-rejection trace) and a non-zero exit code that the caller can distinguish from a successful run.
  - Script imports the verified SDK transport client (`grep -nE "@modelcontextprotocol/sdk" scripts/run-fomi-via-https.ts` returns ≥1 match).
- **Dependencies:** T01 (transport client patterns)
- **Complexity:** M

#### T-final-3b — Execute the HTTPS client against the LIVE deployed endpoint + capture artifact
- **Goal:** After the Fly deploy lands and DNS resolves (or has been confirmed not-yet-propagated and the fallback path is chosen), execute `validate_idea` against the Fomi case end-to-end through the production HTTPS endpoint. Capture the artifact at `.planning/validation-runs/03-fomi-via-https.md`.

  **Execution flow:**
  1. Confirm DNS: `dig getvetoed.com CNAME`.
     - If it resolves to the Fly target: use `https://getvetoed.com/mcp`.
     - **(OQ2) Fallback:** if DNS has NOT propagated, use `https://vetoed-mcp.fly.dev/mcp` directly. Both are HTTPS; both prove the transport layer. Document which endpoint was used in the artifact's frontmatter + commit message. File a follow-up T-final-3b-redo for once DNS resolves IF the fallback was used.
  2. Issue a test token: `flyctl ssh console -a vetoed-mcp` → `npm run admin -- issue-token --email=test@example.com`. Save the `pv_<…>` value to `$VETOED_TEST_TOKEN`.
  3. Run the client script (T-final-3a):
     ```
     npx tsx scripts/run-fomi-via-https.ts \
       --endpoint <chosen URL> \
       --token "$VETOED_TEST_TOKEN" \
       --out .planning/validation-runs/03-fomi-via-https.md
     ```
  4. Verify all rate-limit + auth headers behave (curl smoke before the LLM run): unauthenticated `POST /mcp` → 401 with `WWW-Authenticate`; authenticated `tools/list` → 200 with 13 tools.

  **Per R8 (HTTPS layer may shift signal):** if verdict differs from Phase 02's NO-GO, do NOT calibrate to match. Investigate root cause first. Most likely culprits, in order:
    - Tool-call-level rate limit (T11) firing mid-workflow and cutting tool calls short → verdict shifts to INCONCLUSIVE on some gates. Mitigation: raise threshold for the test run + document.
    - Global Serper cap (T12) hitting because Phase 01/02's pricing data isn't cached on the fresh deploy → some gates degrade to stub data with `fallbacks_used: ['serper_global_cap']`. Mitigation: warm caches by running a sacrificial validation first, OR raise cap temporarily.
    - World changed: new Fomi changelog / new Apple announcements / new PH launches surface a different signal than Phase 02's calibration anchor. Document as a Phase 04 candidate (refresh calibration anchor) per Phase 02 R7 triage rule. **Do NOT change `assert-fomi-run.ts` to match.**

  Spec § anti-pattern compliance: this run MUST exercise the actual hosted endpoint, not localhost. The point is to prove the HTTPS layer doesn't break anti-bias guarantees end-to-end.
- **Files:** `.planning/validation-runs/03-fomi-via-https.md` (new — full artifact). No code files (uses T-final-3a's script).
- **Spec refs:** §10 Phase 4 Critical Test (full calibration arm); §11 DoD ("validate_idea returns NO-GO with sound reasoning"); CONTEXT.md success criteria; OQ2 (DNS fallback).
- **Acceptance:**
  - Artifact captured at `.planning/validation-runs/03-fomi-via-https.md` with a verdict block.
  - Verdict MUST be NO-GO.
  - Artifact word count ≥ 4000 (sanity check that the full workflow ran end-to-end, not a truncated stub).
  - Artifact frontmatter records which endpoint was used (`getvetoed.com` vs `vetoed-mcp.fly.dev`) per OQ2.
  - At least one Gate 3 DOK 1 fact still mentions Apple Intelligence / Screen Time / Focus Modes / Digital Wellbeing (Phase 02 T06 synonym map fired correctly via HTTPS).
- **Dependencies:** T-final-2 (cheap pre-flight first); T-final-3a (script must exist); T18 (deploy must have happened); T19 (DNS docs); T09 + T16 (admin CLI in-container to issue token).
- **Complexity:** L

#### T-final-4 — `scripts/assert-fomi-run.ts --artifact 03-fomi-via-https.md` exits 0 (6/6 PASS)
- **Goal:** Run the mechanical assertion harness against the HTTPS-captured artifact. The Phase 02 `--artifact` flag (added in Phase 02 T-final-3) is reused here. Expected output:
  ```
  [T20] Assertion 1: Verdict NO-GO ........................ PASS
  [T20] Assertion 2: Killshots cite ≥2 tier S/A ........... PASS
  [T20] Assertion 3: Gate 3 references encroachment kws ... PASS
  [T20] Assertion 4: Tool call count line present ......... PASS
  [T20] Assertion 5: Killshot count ≥ 2 ................... PASS
  [T20] Assertion 6: Spiky POV blank template intact ...... PASS
  [T20] OVERALL: 6/6 assertions passed — HTTPS Phase-03 artifact ✓ — Phase 03 done.
  ```

  Also includes an additional Phase 03-specific smoke checklist (recorded in commit message, NOT in assert-fomi-run since these are transport-layer not validator-layer concerns):
  - `[✓] unauthenticated POST /mcp returns 401 + WWW-Authenticate: Bearer realm="vetoed"`
  - `[✓] authenticated tools/list returns 13 tools`
  - `[✓] over-quota POST /mcp returns 429 + Retry-After`
  - `[✓] global-cap simulated (or observed): tool response shape includes 'serper_global_cap' in fallbacks_used (NO 429)`
  - `[✓] GET / returns landing page HTML`
  - `[✓] GET /admin/ with ADMIN_PASSWORD unset returns 500 (C1 fail-closed verification on the live deploy)`
  - `[✓] GET /admin/ with ADMIN_PASSWORD set returns 401 + WWW-Authenticate: Basic`
  - `[✓] authenticated GET /admin/api/tokens returns the test token issued in T-final-3b`
  - `[✓] admin password not present in `flyctl logs` output (R6 leak check)`

  **If any 6/6 assertion fails OR any smoke checklist item fails:** STOP. Per R8 + Phase 02 R7 triage rule: do NOT change the assertion script or validator. Identify which task in T01–T29 introduced the regression, route to its stream owner, fix at root.
- **Files:** none (runs existing script + records smoke results in commit message). Possibly extends `scripts/assert-fomi-run.ts` if any Phase 03-specific assertion proves load-bearing — but per principle, transport-layer concerns stay out of `assert-fomi-run.ts` (which is the anti-bias validator's regression gate).
- **Spec refs:** §10 Phase 4 Critical Test; §11 DoD; CONTEXT.md success criteria (Fomi via HTTPS); C1 (fail-closed smoke).
- **Acceptance:**
  - `assert-fomi-run.ts --artifact .planning/validation-runs/03-fomi-via-https.md` exits 0 with 6/6 PASS.
  - Commit message lists all 9 transport-layer smoke checks as passed (NB: list grew from 7 in v0.1 to 9 in v0.2 — adds global-cap graceful-degradation check + C1 fail-closed live-deploy check).
- **Dependencies:** T-final-3b
- **Complexity:** S

---

## Dependency Graph

```
Stream A (HTTP transport — sequential, single subsystem)
  T00 (optional spike) ──▶ T01 ──▶ T02 ──▶ T03 ──▶ T04
                          │
                          └──▶ unlocks Streams B/C/E/F (Express app must exist)

Stream B (Auth — DB → tokens → middleware → tests)
  T05 ──▶ T06 ──▶ T07 ──▶ T08
                          │
  T06 ────────────────▶ T09
  T07,T08,T09 ─────────▶ T10

Stream C (Rate limiting — depends on T05 + T07)
  T05 ──▶ T11
  T05 ──▶ T12
  T07 + T11 ─────────▶ T13
  T01 + T07 + T11 ───▶ T14
  T11,T12,T13 ───────▶ T15

Stream D (Deploy — depends on T02 + T03 + T09 minimally)
  T02,T03,T09 ──▶ T16 ──▶ T17 ──▶ T18
                           │
                           └──▶ T19 ──▶ T20

Stream E (Observability — parallel-ish with B/C/F)
  T01 ──▶ T21
  T03,T05,T21 ──▶ T22
  T17 ──▶ T23 ──▶ T24
  T16 ──▶ T24  (NEW in v0.2: T24 needs T16's `scripts/` inclusion for the in-container admin runbook)

Stream F (Landing + admin — depends on T01 + B + C)
  (none)            ──▶ T25
  T01 + T25         ──▶ T26
  T26 + T21         ──▶ T27
  T27 + T06 + T14   ──▶ T28
  T27 + T28         ──▶ T29

Final (Stream G)
  {all above} ──▶ T-final-1 ──▶ T-final-2 ──▶ T-final-3a ──▶ T-final-3b ──▶ T-final-4
                                              (script)       (live run)     (assert)
```

**Critical path (longest sequence, v0.2):**
T00 → T01 → T02 → T16 → T17 → T18 → T-final-1 → T-final-2 → T-final-3a → T-final-3b → T-final-4 (11 tasks).

Or, on the auth/admin path: T01 → T05 → T06 → T07 → T13 → T14 → T28 → T29 → T-final-3b → T-final-4 (10 tasks).

The deploy path is now critical at 11 (one longer than v0.1) because the T-final-3 split adds a node. The auth path is unchanged.

**Parallelism opportunities (cross-stream — explicit for `/gsd-execute-phase`):**

- **Wave 0 (optional pre-flight):** T00.
- **Wave 1 (no inter-dep):** T01 (Stream A), T05 (Stream B), T25 (Stream F — pure static HTML).
- **Wave 2 (unlocked by Wave 1):** T02, T03 (after T01); T06 (after T05); T11, T12 (after T05); T21 (after T01); T26 (after T01 + T25).
- **Wave 3:** T04 (after T01–T03); T07, T09 (after T06); T13 (after T07 + T11); T22 (after T03 + T05 + T21).
- **Wave 4:** T08 (after T07); T14 (after T01 + T07 + T11); T15 (after T11 + T12 + T13); T16 (after T02 + T03 + T09); T27 (after T26 + T21).
- **Wave 5:** T10 (after T07 + T08 + T09); T17 (after T16); T28 (after T27 + T06 + T14).
- **Wave 6:** T18 (after T17); T19 (after T17); T23 (after T17); T29 (after T27 + T28).
- **Wave 7:** T20 (after T19); T24 (after T17 + T23 + T16).
- **Wave 8 (sequential bookkeeping + regression):** T-final-1 → T-final-2 → T-final-3a → T-final-3b → T-final-4.

**Anti-parallelism (file-conflict locks):**
- Stream A tasks (T01–T04) all touch `src/http/server.ts` → sequential within stream.
- Stream B tasks share `src/auth/*` → sequential.
- Stream C tasks share `src/ratelimit/*` → sequential.
- Multiple streams touch `src/http/server.ts` (T01, T03, T07, T13, T14, T21, T26, T27, T28). Per executor: serialize these edits. Concretely, T01 is the foundation; T03/T21/T26/T27 are additive route registrations and can be sequenced any order after their own stream deps are met.

---

## Risks & Mitigations

### R1: Express + StreamableHTTPServerTransport integration is undocumented
**Concern:** The MCP SDK's Streamable HTTP examples in current docs may use Hono or raw Node, not Express. Express might need extra glue (manual chunked-body handling, response stream forwarding, session-id header propagation, body re-parsing because `express.json()` consumed it). T01 is the foundation; if its pattern is wrong, everything downstream regresses.

**Mitigation:**
- T00 (optional spike, ≤1h timebox) verifies the SDK API surface BEFORE T01 starts. Output captured at `.planning/phases/03-multitenant-https/sdk-mount-spike.md`.
- T01 explicitly prototypes the mounting pattern BEFORE downstream tasks build on it. The acceptance requires a code comment documenting the verified SDK API surface + the literal SDK version (C10).
- Wave 1 isolates T01; Waves 2+ all gate on its completion. If T01 discovers the pattern requires non-trivial glue, scope expands here (still L complexity — has headroom) rather than rippling.
- If the SDK ships an official Express adapter (per the README mention of `@modelcontextprotocol/express`), use it; otherwise hand-roll per the SDK examples.
- T04 (local smoke test) is the integration gate: if `tools/list` doesn't return 13 tools via HTTP, T01's pattern is wrong; fix before Wave 3.

### R2: SQLite + Fly persistent volume
**Concern:** `better-sqlite3` requires a writable filesystem. Fly's ephemeral filesystem is read-only-ish (writes don't survive restart); persistent volumes work but need a `[mounts]` config in `fly.toml`. If the volume isn't mounted, tokens vanish on every deploy.

**Mitigation:**
- T17 explicitly requires the `[mounts]` block at `destination = "/data"` with a named volume.
- T05 reads `process.env['VETOED_DB_PATH'] ?? '/data/vetoed.db'` — dev fallback to `./vetoed.db` (writable cwd).
- T16 Dockerfile sets `MCP_TRANSPORT=http` and `VETOED_DB_PATH` defaults to the mounted path via T17's `[env]` block.
- **(C4 v0.2)** `flyctl volumes create vetoed_data --size 1 --region iad` is a documented one-time prereq surfaced in (a) T17 commit message body, (b) T18 workflow commit message, AND (c) `docs/OPERATIONS.md` First-time-deploy-prereqs section (T23). No ambiguity.
- Pre-deploy verification: T18 CI doesn't deploy until tests pass; first deploy is manual (`flyctl deploy` from local) so Aljosa can confirm the volume is healthy via `flyctl volumes list` before flipping CI to auto-deploy.

### R3: DNS propagation timing
**Concern:** Cloudflare / registrar propagation can take 15min–24h. T-final-3b (fresh-LLM Fomi test) requires `getvetoed.com` to resolve to the Fly app. If T-final-3b runs before DNS propagates, it fails for the wrong reason.

**Mitigation:**
- T19 doc explicitly instructs the user to wait for `dig getvetoed.com CNAME` to resolve before T-final-3b.
- T-final-3b acceptance includes an OQ2 fallback: if DNS hasn't propagated, run against `https://vetoed-mcp.fly.dev/mcp` directly. Both are HTTPS; both prove the transport layer. Endpoint chosen is recorded in artifact frontmatter.
- A T-final-3b-redo is filed against Phase 04 if the fallback path was taken, so the canonical `getvetoed.com` endpoint gets verified once DNS lands.

### R4: Stdio transport regression
**Concern:** Refactoring `src/index.ts` to branch on `MCP_TRANSPORT` (T02) is the highest-risk regression point. Phase 01's `assert-fomi-run.ts` regression and the existing Claude Desktop config both depend on the stdio path working exactly as before.

**Mitigation:**
- T02 acceptance explicitly verifies BOTH paths: unset env var → stdio (default), `=http` → HTTP. The default-path verification covers the regression risk.
- **(C5 v0.2)** T02 acceptance ALSO includes an immediate post-commit run of `npx tsx scripts/assert-fomi-run.ts` (default artifact). Catches stdio regressions at T02, not 30+ tasks downstream.
- T-final-2 re-runs `assert-fomi-run.ts` against a captured Phase 02 artifact as a second-line gate — catches accumulated drift from any of T03–T29.
- If T02's refactor accidentally re-orders tool registration (e.g., the import block gets moved below the transport selection), `assert-fomi-run.ts` will fail Assertion 4 (tool count). Fix at root.

### R5: Rate-limit race conditions
**Concern:** Two concurrent requests against the same token can both pass a "current count < limit" check before either inserts into `usage_log`. With 20-runs-per-day quotas, this is a small leak: 1–2 extra calls per token per day in pathological-concurrency scenarios.

**Mitigation:**
- T11 + T12 use SQLite WAL mode (per T05 PRAGMA setting). The global-cap increment (T12) is wrapped in a single `BEGIN; SELECT count; INSERT-or-update; COMMIT;` transaction to minimize the window.
- Per-token rate limiter (T11) uses a SELECT-then-allow pattern; the race window is documented in the file header comment as acceptable (1–2 extra calls per day worst case).
- Per CONTEXT.md decision 2: the global cap of 1,500 has explicit headroom (~1,300 expected at full saturation of 5 users × 20 runs × 13 tool calls). 1–2 race-extras per day is well within the 200-call headroom.
- This is documented as acceptable in T11 + T12 file-header comments AND in `docs/OPERATIONS.md` (T23) as a known operational characteristic.

### R6: Admin password leakage
**Concern:** `ADMIN_PASSWORD` env var must NEVER be logged, never printed in error stacks. A leaked admin password = full token-management access = ability to issue tokens to attackers + revoke legitimate users. Worse failure mode: **unset env var silently allows admin access** because empty-string comparison succeeds against an empty supplied password.

**Mitigation:**
- T21 pino redact list explicitly includes `ADMIN_PASSWORD` substring matches across log payloads + `*.authorization` paths (covers Basic auth headers too).
- T21 acceptance includes a smoke test: `ADMIN_PASSWORD=hunter2hunter2 npm run smoke:http` → `grep hunter2hunter2` over captured stdout returns ZERO matches.
- **(C1 v0.2)** T27 admin middleware **fails closed**: returns HTTP 500 if `ADMIN_PASSWORD` is unset, empty, or shorter than 12 chars. Acceptance test asserts the 500 explicitly (NOT 401, NOT 200). T-final-4 verifies this on the live deploy.
- **(C2 v0.2)** T27 uses `crypto.timingSafeEqual` over the FULL `user:pass` Buffer (not the password alone). Single comparison site, code-review-enforced (no `===` / `==` on credentials).
- T-final-4 smoke checklist includes verifying `flyctl logs` output contains no `ADMIN_PASSWORD` value.
- Future enhancement (Phase 04 candidate): rotate to a hashed `ADMIN_PASSWORD_HASH` env var so the plaintext never lives in the running process. Deferred for v1 simplicity.

### R7: Landing page copy is minimum-viable
**Concern:** For v1 the copy is whatever Aljosa writes in T25. It might be unpolished, off-brand, or contain typos. Sending users to a landing page that looks like a placeholder hurts adoption.

**Mitigation:**
- T25 acceptance is explicitly "renders cleanly" (`html-validate` exit 0, no broken hrefs); not "marketing-team approved."
- Static HTML file → Aljosa iterates without code change OR phase plan. Push a copy edit → CI deploys.
- Phase 03 Out-of-Scope explicitly lists "Marketing copy polish" as Post-merge candidate.
- Trade-off documented: ship a minimum-viable landing page now and iterate based on user reaction, rather than block the phase on copy.
- **(OQ5 v0.2)** T25 mailto placeholder is `aljosa@getvetoed.com`. Aljosa configures DNS + mailbox before T25 commits; if unavailable at commit time, fallback to personal address + file a Phase 04 D-XX for rebrand.

### R8: Fresh-LLM Fomi run via HTTPS may show different signal than Phase 02's stdio run
**Concern:** A fresh `validate_idea` over HTTPS introduces new variables: rate-limit interactions mid-workflow, fresh-cache (no warm SHORT-TTL hits from Phase 02), possible DNS/TLS latency affecting tool timeout behavior, model-version drift since the Phase 02 calibration was captured. T-final-3b could fail for legitimate reasons that aren't Phase 03 bugs.

**Mitigation:**
- **Triage rule (load-bearing, mirrors Phase 02 R7):** if T-final-3b fails, do NOT modify the validator, `assert-fomi-run.ts`, or test fixtures. Investigate which assertion failed; route to the most likely culprit per T-final-3b's task body. If the regression is attributable to a Phase 03 task, fix at root. If it's "the world changed," document as Phase 04 candidate (refresh calibration anchor); do NOT calibrate to match.
- T-final-2 (pre-flight against the captured Phase-02 artifact) catches structural code-level breaks cheaply. If T-final-2 passes and T-final-3b fails, the divergence is data-level, not code-level.
- The Phase 02 artifact remains the canonical calibration anchor. Phase 03 verifies the HTTPS layer doesn't introduce a new failure mode; it doesn't re-establish the anchor.

### R9 *(NEW in v0.2)*: T00 SDK spike not run before T01 → wrong mount pattern
**Concern:** T00 is OPTIONAL. If it's skipped, T01 starts without a verified mount pattern and may need to discover Express ↔ StreamableHTTPServerTransport glue mid-implementation. This could push T01 past its L budget.

**Mitigation:**
- T01's L-complexity budget explicitly includes headroom for in-task discovery (per R1 mitigation). If T01 needs to expand scope to verify the SDK pattern, that's still within its L allocation.
- T00 is recommended but non-blocking; the spike output is a force-multiplier, not a gate.
- If T01 exceeds its L budget (>6h), STOP and run T00 retroactively, then resume T01 with the documented pattern.

---

## Out of Scope (restated from CONTEXT.md)

- **OAuth 2.1 / Sign-in-with-Google** — Phase 04 if user count > 50.
- **BYO API keys** — Phase 04 if shared-pool quotas get expensive.
- **Per-tool rate limits** — single global + per-token bucket is enough.
- **Self-serve token request UX** — mailto CTA is v1.
- **Multi-region Fly deploy** — single region until latency complaints.
- **Postgres migration** — SQLite scales fine to ~10k users.
- **Tool result caching beyond `src/lib/cache.ts`** — shared cache (Redis) is Phase 04.
- **Detailed analytics dashboard** — admin shows recent log entries only.
- **Billing / paid tier** — none yet.
- **Marketing copy polish** — static HTML allows iteration without phase plan.
- **`bin.weather` cleanup** — `package.json` scaffold leftover; Phase 04 (D-03-6).
- **429 surface for global Serper cap** — v0.2 settles on graceful degradation (D-03-1-a); revisit only if observability demands the 429 surface.

---

## Definition of Done

Each box maps to specific task IDs. Phase 03 ships when every box is checked.

- [ ] **HTTP transport boots:** `MCP_TRANSPORT=http node build/index.js` serves on `:3000`. → **T01** + **T02**.
- [ ] **`tools/list` works via HTTPS:** all 13 tools listable; sample `tools/call` returns standard envelope. → **T01** + **T04**.
- [ ] **Stdio still works:** `MCP_TRANSPORT` unset → stdio default; existing Claude Desktop config + `assert-fomi-run.ts` regression both pass. → **T02** (immediate post-commit check per C5) + **T-final-2**.
- [ ] **401 + correct `WWW-Authenticate` header on missing/invalid token.** → **T07** + **T08** + **T10**.
- [ ] **Admin CLI works, in-container path:** issue-token / list-tokens / revoke-token all functional via `flyctl ssh console` → `npm run admin -- ...`. → **T05** + **T06** + **T09** + **T16** (ships scripts/) + **T24** (runbook).
- [ ] **Per-token rate limit (400 tool calls/day) fires + 429 + `Retry-After`.** → **T11** + **T13** + **T14** + **T15**.
- [ ] **Global Serper cap → graceful degradation (`fallbacks_used: ['serper_global_cap']`), structured warning log, NO 429.** → **T12** + **T15**.
- [ ] **Usage tracked in `usage_log` table** for every successful tool call. → **T05** + **T14**.
- [ ] **Fly.io deploys via `flyctl deploy` (after one-time `flyctl volumes create vetoed_data`).** → **T16** + **T17** + **T18** + **T23** (prereq surfaced in OPERATIONS.md).
- [ ] **DNS resolves `getvetoed.com` → Fly app; HTTPS cert valid (OR documented fallback to `vetoed-mcp.fly.dev`).** → **T19** (user action; doc is deliverable).
- [ ] **`/health` returns enriched status JSON.** → **T03** + **T22**.
- [ ] **All Phase 01/02 tests + new Phase 03 tests pass (≥90 total assertions).** → **T10** + **T15** + included in Phase 02 test count.
- [ ] **Fomi via HTTPS returns NO-GO; `assert-fomi-run.ts --artifact 03-fomi-via-https.md` exits 0 (6/6 PASS).** → **T-final-3a** + **T-final-3b** + **T-final-4**.
- [ ] **`docs/HOSTED_SETUP.md` documents user onboarding + the 400-calls/day rate-limit mapping.** → **T20**.
- [ ] **Landing page renders at `getvetoed.com/`.** → **T25** + **T26**.
- [ ] **Admin dashboard at `/admin` with basic-auth; fail-closed on unset/short ADMIN_PASSWORD (500, not 401); timing-safe credential comparison.** → **T27** + **T28** + **T29**.
- [ ] **pino logger with redaction; no admin password leakage in logs.** → **T21** + R6 smoke check in **T-final-4**.
- [ ] **Operations docs (Fly metrics + volume-create prereq + secrets rotation + admin runbook).** → **T23** + **T24**.
- [ ] **CONCERNS.md updated with Phase 03 deferreds (D-03-1 through D-03-6).** → **T-final-1**.
- [ ] **Branch nomenclature locked: shipped from `phase-v3` → `main`.** → **T-final-1**.

---

## Final Verification Step

T-final-4 is the load-bearing gate. After every other task lands:

```
# Step 1 — pre-flight (T-final-2) against captured Phase-02 artifact
$ npx tsx scripts/assert-fomi-run.ts \
    --artifact .planning/validation-runs/02-fomi-regression-after-phase-02.md
[T20] OVERALL: 6/6 assertions passed — captured Phase-02 artifact ✓

# Step 2 — confirm DNS (or pick fallback)
$ dig getvetoed.com CNAME    # if propagated use getvetoed.com, else use vetoed-mcp.fly.dev

# Step 3 — issue test token (in-container, per T16+T24)
$ flyctl ssh console -a vetoed-mcp
# inside container:
$ cd /app && npm run admin -- issue-token --email=test@example.com
# copy the printed pv_... value, exit, export as $VETOED_TEST_TOKEN

# Step 4 — fresh HTTPS rerun (T-final-3b) using the T-final-3a script
$ npx tsx scripts/run-fomi-via-https.ts \
    --endpoint https://getvetoed.com/mcp \
    --token "$VETOED_TEST_TOKEN" \
    --idea "Fomi: AI-native focus app" \
    --out .planning/validation-runs/03-fomi-via-https.md

# Step 5 — load-bearing assert (T-final-4)
$ npx tsx scripts/assert-fomi-run.ts \
    --artifact .planning/validation-runs/03-fomi-via-https.md
[T20] Assertion 1: Verdict NO-GO ........................ PASS
[T20] Assertion 2: Killshots cite ≥2 tier S/A ........... PASS
[T20] Assertion 3: Gate 3 references encroachment kws ... PASS (matched: "Apple Intelligence")
[T20] Assertion 4: Tool call count line present ......... PASS (≤20 ✓)
[T20] Assertion 5: Killshot count ≥ 2 ................... PASS
[T20] Assertion 6: Spiky POV blank template intact ...... PASS
[T20] OVERALL: 6/6 assertions passed — HTTPS Phase-03 artifact ✓ — Phase 03 done.

# Step 6 — transport-layer smoke (T-final-4 commit message; 9 checks in v0.2)
$ curl -sS -o /dev/null -w "%{http_code}" -X POST https://getvetoed.com/mcp                    # 401
$ curl -sS -H "Authorization: Bearer $VETOED_TEST_TOKEN" \
    -X POST https://getvetoed.com/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'      # 200 + 13 tools
$ # over-quota → 429 + Retry-After (after firing 401 tool calls in a 24h window — or simulated via DB seed)
$ # global-cap → tool response includes 'serper_global_cap' in fallbacks_used, status 200 (NO 429)
$ curl -sS https://getvetoed.com/                                                              # landing page HTML
$ # fail-closed (C1): if ADMIN_PASSWORD is unset, curl localhost:3000/admin/ → 500 (verified on staging)
$ curl -sS -o /dev/null -w "%{http_code}" https://getvetoed.com/admin/                         # 401 (when password is set)
$ # authenticated admin: GET /admin/api/tokens returns the test token issued above
$ flyctl logs --since 1h | grep -F "$ADMIN_PASSWORD"                                           # zero matches (R6)
```

Exit code 0 on T-final-2 AND T-final-4 + all 9 transport smokes all green = Phase 03 done.

---

## Changelog

- **v0.2** (2026-05-26) — addressed PLAN-CHECK.md (4 blockers, 5 warnings, 1 info applied + 5 open questions resolved). New task count: 35 (was 33; T-final-3 split into T-final-3a/3b, +1 optional T00 spike). Changes:
  - **C1 (BLOCKER):** T27 admin middleware now fails-closed (HTTP 500) on unset/empty/short `ADMIN_PASSWORD`. Acceptance test added; live-deploy verification in T-final-4.
  - **C2 (BLOCKER):** T27 uses `crypto.timingSafeEqual` over the full `user:pass` Buffer (not password alone); `ADMIN_USERNAME` env-var override; `===`/`==` on credentials forbidden.
  - **C3 (BLOCKER):** T16 Dockerfile now INCLUDES `scripts/` so `flyctl ssh console` → `npm run admin` works in-container. T24 runbook updated to canonical SSH path.
  - **C4 (BLOCKER):** T17 commit message + `docs/OPERATIONS.md` (T23) explicitly document the one-time `flyctl volumes create vetoed_data --size 1 --region iad` prereq.
  - **C5 (WARNING):** T02 now runs `assert-fomi-run.ts` (default artifact) immediately post-commit — catches stdio regressions at T02, not deferred to T-final-2.
  - **C6 (WARNING):** T11 per-token threshold raised to **400 tool calls/day** (was 260) to honor spec UPPER bound of 20 tool calls/run. Math documented in T11 file-header AND T20 HOSTED_SETUP.md.
  - **C7 (WARNING):** CONTEXT.md updated: global Serper cap = graceful degradation at `src/lib/serper.ts` (NO 429 from HTTP layer; 429 reserved for per-token cap). Filed as D-03-1-a in T-final-1.
  - **C8 (WARNING):** CONTEXT.md updated: token prefix is first 7 chars (`pv_xxxxx`), not last 4. Filed as D-03-2 in T-final-1.
  - **C9 (WARNING):** T-final-3 split into T-final-3a (build script, smoke against placeholder URL) + T-final-3b (execute against live deployment + capture artifact ≥4000 words). Atomic-rollback friendly.
  - **C10 (INFO):** T01 file-header comment now records verified SDK version (e.g., `@modelcontextprotocol/sdk@<X.Y.Z>`) + entry-point path, grep-enforced.
  - **OQ1:** T00 optional 30-min SDK API-surface spike added. Non-blocking; absorbed by T01's L budget if skipped.
  - **OQ2:** T-final-3b acceptance explicitly allows fallback to `vetoed-mcp.fly.dev/mcp` if DNS hasn't propagated; endpoint recorded in artifact frontmatter.
  - **OQ3:** `bin.weather` cleanup deferred to Phase 04 (D-03-6).
  - **OQ4:** Fly app name confirmed as `vetoed-mcp` in T17.
  - **OQ5:** T25 mailto placeholder is `aljosa@getvetoed.com`; Aljosa configures DNS + mailbox pre-T25.
  - **R9 (NEW):** Risk of skipping T00 → wrong mount pattern. Mitigation: T01's L-budget absorbs the discovery cost; if T01 exceeds L, run T00 retroactively.
- **v0.1** (2026-05-26) — initial. 33 tasks across 7 streams. Critical path 9–10 tasks (deploy path vs auth path, parallel). Estimated total complexity: 13 S + 14 M + 6 L = 33 tasks. All tasks atomic-committable.

---

*Phase plan v0.2. 35 tasks across 7 streams (34 mandatory + 1 optional). Critical path: 11 sequential tasks (deploy path) / 10 (auth path; parallel). Estimated complexity: 15 S + 15 M + 3 L + 1 optional M. Plan ready for `/gsd-execute-phase`.*
