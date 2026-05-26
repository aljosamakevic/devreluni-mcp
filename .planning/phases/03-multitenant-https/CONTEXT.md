# Phase 03 — Multi-Tenant HTTPS Transport

## Phase goal

Ship the ProductValidation MCP as a hosted HTTPS service at `https://getvetoed.com/mcp` that other founders and PMs can use via their Claude Desktop / Cursor — without each user needing to install Node, clone the repo, or manage their own API keys. Preserve the existing stdio transport for local development.

This is the bridge from "personal tool that works on my laptop" to "shared infrastructure that 10-50 cohort members + DevRel Uni participants can validate ideas with."

## Why this matters

Phase 01 + 02 made the MCP production-quality on a technical level (anti-bias guarantees structurally enforced, 70/70 tests, tool emissions clean, calibration green). But it's still deployment-locked to a single machine with a `.env` file. Phase 03 closes the gap to "real users can use this without you in the loop."

The point of multi-tenancy isn't scale — it's **distribution**. A founder evaluating an idea at 11pm shouldn't need to clone a repo to run the framework.

## Architectural decisions (locked with user 2026-05-25)

1. **Auth = Rung 1: Static bearer tokens, manually issued**
   - Aljosa generates tokens via CLI (`npm run admin -- issue-token --email=alice@example.com`)
   - Tokens stored in SQLite (`tokens` table) with email label + created_at + last_used_at + status (active/revoked)
   - Token format: `pv_<base64url-32bytes>` (the `pv_` prefix makes leaked tokens grep-able in logs)
   - User pastes token into Claude Desktop config `headers: { Authorization: "Bearer pv_..." }`
   - Server middleware validates on every request
   - 401 with `WWW-Authenticate: Bearer realm="vetoed"` if missing/invalid (spec-friendly)
   - **Why not OAuth 2.1 yet:** spec allows out-of-band token issuance. With <50 users you can email directly; OAuth pays its complexity tax with no UX gain. Migration path stays open — bearer-token validation is identical wire shape.

2. **Secrets model = (b) Shared pool with two-layer rate limiting**
   - Aljosa funds the Serper / Product Hunt / GitHub keys (stored in Fly secrets, never exposed to users)
   - **Per-token rate limit:** 20 `validate_idea` runs / day / token. Enforced at the **tool-call layer** because the MCP server cannot observe a "prompt invocation" — prompts are LLM-side orchestration. The spec §11 DoD budget upper-bound is ~20 tool calls per `validate_idea`, so the operational threshold is **400 tool calls / day / token** (20 runs × 20 tool calls/run worst case). A typical run fires ~13 tool calls; users hitting the budget cap on every run still get ~20 validations/day. Exceeded → **429 + `Retry-After` header**.
   - **Global rate limit:** hard cap of **1,500 Serper calls / UTC day** so a leaked token can't burn through the month's quota in one day. **Behavior on exceeded: graceful degradation at the `src/lib/serper.ts` layer** — return stub data, push `fallbacks_used: ['serper_global_cap']`, downgrade source tier to D / bias unknown. **No 429** is emitted for the global cap because the cap fires mid-tool-call after the auth + per-token middleware have already passed; the HTTP layer cannot honestly turn a partially-served JSON-RPC response into a 429. This preserves spec §11 anti-pattern 2 ("never fail silently") + §7 graceful degradation. 429 is reserved exclusively for the **per-token** cap. Structured warning log emitted on every global-cap hit.
   - Usage tracked per-token in `usage_log` table for visibility + analytics

3. **Hosting = Fly.io**
   - Single app deployed via `flyctl deploy`
   - Persistent volume for SQLite (`/data/vetoed.db`)
   - Fly's automatic HTTPS via Let's Encrypt
   - DNS: `getvetoed.com` CNAME → `<app>.fly.dev`
   - One region to start (probably IAD or LHR); add more if latency complaints emerge

4. **Domain = getvetoed.com**
   - MCP endpoint: `POST https://getvetoed.com/mcp` (Streamable HTTP transport)
   - Health endpoint: `GET https://getvetoed.com/health` (for Fly healthchecks + monitoring)
   - **Marketing landing page at `GET /`** — single static HTML page explaining what Vetoed is, who it's for, "request access" call-to-action (mailto:aljosa@... or simple email-collection form for v1)
   - **Admin dashboard at `GET /admin`** — basic-auth gated (single `ADMIN_PASSWORD` env var). Shows token list, issue/revoke buttons, recent usage stats. Static HTML + small JS that calls `/admin/api/*` endpoints. No SPA framework.

5. **Transport: Streamable HTTP (MCP spec 2025-03-26)**
   - `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` (sibling to the existing `StdioServerTransport`)
   - Stdio stays as the default for local dev
   - Env var `MCP_TRANSPORT=http|stdio` (default `stdio`) selects mode at boot
   - Same `McpServer` instance, two transport options — minimal code duplication

6. **HTTP framework = Express**
   - User-selected for ecosystem familiarity + middleware compatibility
   - Used as the outer HTTP layer; MCP's `StreamableHTTPServerTransport` mounts onto an Express route handler at `POST /mcp`
   - ESM imports via Node 22 ESM support; no CJS interop needed since Express 4.x exports work in ESM-mode-Node

7. **Database = SQLite via `better-sqlite3`**
   - Tables: `tokens`, `usage_log`, `rate_limits`
   - File at `/data/vetoed.db` on Fly volume
   - No migrations framework needed for v1 — schema lives in a single `src/db/schema.sql` file, applied on boot via `IF NOT EXISTS`
   - When tables/queries exceed ~5 files of complexity, swap to a real migration system (Phase 04 candidate)

8. **Observability = pino (structured JSON logs to stdout)**
   - Fly captures stdout automatically into its log stream
   - All MCP traffic logged with `{ token_id, tool, duration_ms, status }`
   - Sensitive fields redacted (no raw API keys, no user input bodies beyond the first 200 chars)

## Scope — what ships in Phase 03

### Stream A — HTTP transport
- A1: Add Express HTTP wrapper (`src/http/server.ts`) that boots an HTTP server, mounts a `/mcp` POST route, terminates Streamable HTTP transport from MCP SDK
- A2: Refactor `src/index.ts` to branch on `MCP_TRANSPORT` env var; stdio stays default, HTTP enabled with `MCP_TRANSPORT=http`
- A3: Health endpoint `GET /health` returning `{ status, version, uptime_s, db_ok }`
- A4: Local smoke test — `curl localhost:3000/mcp` JSON-RPC tools/list returns 13 tools

### Stream B — Bearer token auth
- B1: `src/db/schema.sql` — tokens + usage_log + rate_limits tables
- B2: `src/db/connection.ts` — better-sqlite3 connection wrapper with `IF NOT EXISTS` schema bootstrap
- B3: `src/auth/tokens.ts` — token issue/validate/revoke functions
- B4: Express middleware `authRequired` — extracts `Authorization: Bearer X`, validates, attaches `token_id` to `req.locals`. Returns 401 + `WWW-Authenticate` on miss.
- B5: Token CLI — `scripts/admin.ts` with `issue-token`, `list-tokens`, `revoke-token` commands; runs locally against the production DB via Fly proxy or remotely via `fly ssh console`
- B6: Tests — token validation happy path + 401 paths

### Stream C — Rate limiting
- C1: Per-token rate limiter (token bucket or sliding window via SQLite)
- C2: Global rate limiter (single counter in SQLite, reset daily)
- C3: Middleware `rateLimit` returns 429 + `Retry-After` when exceeded
- C4: `usage_log` insertion on every successful tool call
- C5: Tests — rate-limit fires at the right thresholds

### Stream D — Deployment + DNS
- D1: `Dockerfile` (multi-stage, Node 22, runs `node build/index.js` with `MCP_TRANSPORT=http`)
- D2: `fly.toml` — single app, persistent volume mount, env config, healthcheck
- D3: GitHub Actions workflow `.github/workflows/deploy.yml` — on push to main, run tests + build, then `flyctl deploy`
- D4: DNS configuration documentation (CNAME `getvetoed.com` → `<app>.fly.dev`)
- D5: Onboarding doc `docs/HOSTED_SETUP.md` — how a user adds the MCP to Claude Desktop with their bearer token

### Stream E — Observability + safety
- E1: pino logger setup; redacted fields list (`api_keys`, request bodies > 200 chars)
- E2: Health endpoint reports DB status, last error timestamp, cache hit rate
- E3: Basic Fly metrics dashboard reference (just docs — no custom dashboard)
- E4: Secrets management documentation — how Aljosa rotates the shared API keys

### Stream F — Marketing landing page + Admin dashboard
- F1: Static landing page at `GET /` — single HTML file at `public/index.html` with inline CSS. Sections: hero ("Vetoed — kill bad product ideas before you build them"), how it works (5 gates, one-paragraph each), social proof slot, "Request access" CTA (mailto link for v1, room for an email form later)
- F2: Express static-file serving for `public/` directory
- F3: Admin dashboard at `GET /admin` — basic-auth middleware (single `ADMIN_PASSWORD` env var), serves a single-page HTML with vanilla JS that calls `/admin/api/tokens`, `/admin/api/usage`
- F4: Admin API endpoints: `GET /admin/api/tokens` (list), `POST /admin/api/tokens` (issue), `DELETE /admin/api/tokens/:id` (revoke), `GET /admin/api/usage` (recent log entries grouped by token)
- F5: Smoke test — landing page renders, admin dashboard requires basic auth, admin actions update the SQLite tables correctly

### Stream G — Calibration regression after going hosted
- G1: Run `validate_idea` end-to-end against the Fomi case via the HTTPS endpoint (using `curl` or a test client with bearer token)
- G2: Assert NO-GO verdict + 6/6 mechanical assertions still pass (re-use `scripts/assert-fomi-run.ts`)
- G3: Confirm tool call count + auth + rate-limit headers all behave correctly
- G4: Capture artifact as `.planning/validation-runs/03-fomi-via-https.md`

## Out of scope for Phase 03 (post-merge candidates)

- **OAuth 2.1 / Sign-in-with-Google** — Phase 04 if user count > 50 or self-serve onboarding becomes critical
- **BYO API keys** option — Phase 04 if shared-pool quotas get expensive
- **Per-tool rate limits** — single global + per-token bucket is enough; per-tool granularity = optimization
- **Self-serve token request UX** — landing page CTA is mailto for v1; an email-collection form + auto-email Aljosa is a small Phase 04 addition
- **Multi-region Fly deploy** — single region until latency complaints emerge
- **Postgres migration** — SQLite scales fine to ~10k users for this workload
- **Tool result caching beyond what's in `src/lib/cache.ts`** — current cache is per-process; shared cache (Redis) is Phase 04
- **Detailed analytics dashboard** — admin dashboard shows recent log entries grouped by token, but no charts or longitudinal views in v1
- **Billing / paid tier** — none of that yet; everyone free, rate-limited
- **Marketing copy polish** — landing page is minimum-viable copy + layout for v1; can iterate later without code change since it's a static HTML file

## Success criteria

- [ ] `MCP_TRANSPORT=http node build/index.js` boots an HTTP server on port 3000
- [ ] `curl -X POST localhost:3000/mcp -H "Authorization: Bearer pv_test_..." -d '{"jsonrpc":"2.0",...}'` works end-to-end for `tools/list` and a sample `tools/call`
- [ ] Requests WITHOUT a valid bearer token return 401 with `WWW-Authenticate: Bearer realm="vetoed"` header
- [ ] Requests exceeding per-token rate limit return 429 with `Retry-After` header
- [ ] Requests exceeding global Serper cap log a structured warning AND degrade to stubbed Serper output with `fallbacks_used: ['serper_global_cap']` (no 429 for global cap — graceful degradation at the `src/lib/serper.ts` layer; 429 is reserved for the per-token cap)
- [ ] `npm run admin -- issue-token --email=alice@example.com` creates a token, prints it, stores it in DB
- [ ] `npm run admin -- list-tokens` shows all active tokens by **first 7 chars (`pv_xxxxx`)** prefix only, plus email + last_used. Full token is shown only at issuance time and never again.
- [ ] `npm run admin -- revoke-token <id-or-prefix>` marks a token revoked; next request with it returns 401
- [ ] App boots on Fly.io via `flyctl deploy`
- [ ] `https://getvetoed.com/mcp` resolves through Cloudflare/DNS and serves the MCP endpoint
- [ ] `https://getvetoed.com/health` returns 200 with `{ status: "ok", version: ..., uptime_s: ..., db_ok: true }`
- [ ] Stdio transport still works locally for development (no regression)
- [ ] All 70 existing tests still pass + new tests for auth/ratelimit/transport (target: 90+ tests)
- [ ] Fomi calibration via HTTPS returns NO-GO with 6/6 assertions (regression intact via the hosted endpoint)
- [ ] `docs/HOSTED_SETUP.md` documents user onboarding (add token to Claude Desktop config)
- [ ] Landing page renders at `https://getvetoed.com/` with basic copy + CTA
- [ ] Admin dashboard at `https://getvetoed.com/admin` requires basic-auth; can list/issue/revoke tokens
- [ ] CONCERNS.md updated with any new Phase 03 deferreds (D-XX entries)
- [ ] Branch nomenclature locked: this phase shipped from `phase-v3` → `main`. Future phases use `phase-vN`.

## Constraints

- **Phase 01 + 02 guarantees stay inviolate.** Validation pipeline (`src/validation/`), bias helper (`src/lib/bias.ts`), and rewritten prompt (`src/prompts/validate-idea.ts`) are untouched. The auth/transport layer wraps them; it doesn't replace them.
- **Stdio transport must keep working** (devs need it; the `scripts/assert-fomi-run.ts` regression depends on it).
- **No regression on the Critical Test.** `scripts/assert-fomi-run.ts` must still pass against existing artifacts AND against a fresh run via the HTTPS endpoint.
- **No new fabricated data.** Auth failures return structured errors; never fabricate tool responses.
- **Atomic commits.** Same cadence as Phase 01 + 02. Build green after every commit.
- **Secrets management is non-negotiable.** Real API keys go in Fly secrets, NEVER committed. `.env.example` documents the variable names only.
- **`pv_` token prefix is required.** Makes leaked tokens immediately grep-able. Not optional.
- **The MCP wire shape stays unchanged.** Existing Claude Desktop configs pointing at `localhost` (stdio) continue to work — Phase 03 adds an alternate endpoint, doesn't replace.

## Required reading for planner

- `.planning/spec/build-spec-v1.0.md` — original spec
- `.planning/spec/framework-context.md` — intellectual lineage
- `.planning/codebase/ARCHITECTURE.md` — current layered model
- `.planning/codebase/CONVENTIONS.md` — code conventions
- `.planning/codebase/STRUCTURE.md` — file/folder inventory
- `.planning/phases/01-anti-bias-hardening/PROGRESS.md` — Phase 01 deliverables (must not regress)
- `.planning/phases/02-tool-quality-and-test-harness/PLAN.md` — Phase 02 PLAN structure (use as template)
- `src/index.ts` — the current stdio entry point you'll be branching
- `package.json` — current deps; need to add `express`, `@types/express`, `better-sqlite3`, `@types/better-sqlite3`, `pino`, etc.
- `scripts/assert-fomi-run.ts` — the regression gate
- MCP SDK docs for `StreamableHTTPServerTransport` — verify the exact API surface before T-A1
- Fly.io docs for: persistent volumes, secrets, custom domains, HTTPS termination
- Express docs (4.x or 5.x — confirm in T00 spike) — middleware patterns, error-handling, `req.locals` API
