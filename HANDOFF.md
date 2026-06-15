# Veto — Session handoff

**Date:** 2026-06-15
**Author:** Aljosa + Claude (Claude Code, Opus 4.7 [1M])
**Why this doc exists:** the previous Claude Code session ran long. This file captures every load-bearing fact a fresh session needs to be useful immediately — what's live, what's inviolate, what's queued, how to operate the project. If anything in the codebase contradicts this doc, trust the codebase; this is a snapshot of intent at handoff time.

---

## Quick state

| | |
|---|---|
| **Repo** | `aljosamakevic/devreluni-mcp` (GitHub, private) |
| **Working dir** | `/Users/aljosamakevic/Documents/Buildground/Sandbox/03-devreluni-mcp/devreluni-mcp` |
| **Default branch** | `main` |
| **Latest commit at handoff** | `6a9ba84` (polish: accordion as one unified light document) |
| **Live URL** | `https://getvetoed.com` (Let's Encrypt, expires 2026-08-24; auto-renews via Fly) |
| **Fallback URL** | `https://vetoed-mcp.fly.dev` |
| **Build status** | green (260/260 tests, `assert-fomi-run.ts` 6/6 PASS) |
| **Deploy status** | live, last CI run 27545342093 succeeded in 1m24s |

## What's deployed

- **Hosting:** Fly.io app `vetoed-mcp`, region `iad` (single region)
- **Container:** Multi-stage Dockerfile (Node 22 bookworm-slim), build runs `tsc + tsx scripts/generate-tools-section.ts`
- **Storage:** SQLite (`better-sqlite3`, WAL mode) on persistent Fly volume `vetoed_data` mounted at `/data`
- **CI:** `.github/workflows/deploy.yml` runs on push to `main` → tests → build → `flyctl deploy --remote-only`
- **CI secret:** `FLY_API_TOKEN` (GitHub repo secret, deploy-scoped, 1-year expiry)
- **Fly secrets:** `RESEND_API_KEY`, `ADMIN_PASSWORD`, `SERPER_API_KEY`, `PRODUCTHUNT_API_KEY`, `GITHUB_TOKEN`
- **Fly env (non-secret, in `fly.toml`):** `MCP_TRANSPORT=http`, `PORT=3000`, `VETOED_DB_PATH=/data/vetoed.db`, `BASE_URL=https://getvetoed.com`
- **Email:** Resend, domain `getvetoed.com` verified, from-address `Veto <noreply@getvetoed.com>`

## Phase 01 INVIOLATE — DO NOT TOUCH

These files encode the anti-bias property that makes Veto valuable. They must not be modified by any future work without explicit human review:

- `src/validation/` (entire directory)
- `src/lib/bias.ts`
- `src/prompts/validate-idea.ts`
- `src/tools/finalize-validation-report.ts`

`scripts/assert-fomi-run.ts` must exit 0 with 6/6 PASS after every commit. If it ever fails, fix the regression at root — do not loosen assertions, do not modify the validator, do not modify the script.

## Architecture summary

### Transport
- Stdio (default): `node build/index.js` with `MCP_TRANSPORT` unset/blank/`stdio` — used by Claude Desktop locally. Single `McpServer` instance for the process lifetime.
- HTTP (production): `MCP_TRANSPORT=http` boots an Express app via `createHttpServer(getServer)` in `src/http/server.ts`. **Per-session McpServer factory** (D-03-7 fix) — each new MCP session via `POST /mcp` constructs a fresh McpServer because the SDK forbids one server connecting to multiple transports.

### Surface
| Method | Path | Auth | Rate-limit |
|---|---|---|---|
| GET | `/health` | none | none |
| POST | `/signup` (Phase 04, fallback) | none | per-IP 5/h |
| POST | `/auth/magic-link/request` | none | per-IP 5/h + per-email 5/h |
| GET | `/auth/magic-link/verify` | none (token is auth) | n/a (one-time use) |
| POST | `/mcp` | Bearer | per-token 400/day |
| GET | `/mcp` | none — 405 | n/a |
| GET | `/admin/*` | Basic (`adminAuthRequired`, fail-closed) | none |
| POST/DELETE | `/admin/api/*` | Basic | none |
| GET | `/` + static | none | none |

### MCP entities
- **13 tools** (one per src/tools/*.ts, excluding `*.test.ts`). Order is load-bearing — `assert-fomi-run.ts` counts tool invocations.
- **5 prompts** (validate_idea, steelman_against, run_single_gate, generate_test_cards, quick_kill_check). The prompt-count regression lock at `src/server/prompt-count.test.ts` enforces this.
- **3 resources** (source-tier-bias.md, tool-to-gate-map.md, evaluation-lens-matrix.md). Loaded fresh per invocation.

### Auth + signup
- **Magic-link self-serve (primary):** Phase 05a. User enters email at `https://getvetoed.com/` → `POST /auth/magic-link/request` → email arrives → click verifies → `GET /auth/magic-link/verify?token=...` mints a bearer token + renders inline with Claude Desktop config snippet. 15-min TTL, one-time use. No second email.
- **Admin queue (fallback):** Phase 04. `POST /signup` still works; admin dashboard at `/admin` can approve → token emailed via Resend, or deny → silent.
- **Bearer token shape:** `pv_<base64url-32-bytes>`. Stored as sha256 hash in `tokens.token_hash`. First 7 chars stored as `token_prefix` for grep-friendliness.

### Rate limits (subject to retune — see queue)
- Per-token: 400 tool calls / 24h sliding window. Sufficient for ~20 worst-case spec-bound `validate_idea` runs per day.
- Global Serper: 1,500 calls / UTC day. Graceful degradation when hit (returns stub data + `fallbacks_used: ['serper_global_cap']`, NOT a 429).
- Per-IP: 5/hour on `/signup` + 5/hour each on `/auth/magic-link/request` (per-IP and per-email).

### Observability
- pino structured JSON logs to stdout (Fly captures). Redaction list: `*.authorization`, `*.token`, `*.token_hash`, `*.password`, plus env-var-value substring scrub (`SERPER_API_KEY` etc.).
- `/health` returns `{ status, version, uptime_s, db_ok, last_error_at, cache_hit_rate, transport, checked_at }`. Always 200; subsystem degradation surfaces in the `status` field.

## Active queue (task chips, fetched via the session UI)

These are filed and waiting. The chip system spawns them in a fresh session when you click "Start":

1. **`task_2e5f51d3` — Tune per-token + global rate limits.** Current 400 tool calls/day and 1500 Serper/UTC-day were sized in Phase 03 with no usage data. Revisit when real users land. Affects `src/ratelimit/per-token.ts`, `src/ratelimit/global.ts`, plus user-facing docs in `docs/HOSTED_SETUP.md` and CONCERNS.md D-03-4.

2. **`task_dc941873` — Phase 08: OAuth + per-user rate limits + waitlist tier UI.** Big phase, 4 sub-phases (~21-27 commits total). Unlocks ChatGPT consumer install + cleaner per-user rate limiting + paid tier groundwork (with waitlist signup form on `/account/upgrade` instead of Stripe checkout — Aljosa explicitly chose waitlist over payment integration). **Trigger to dispatch:** first paying-customer signal OR consumer-ChatGPT becomes load-bearing for distribution.

## What was just shipped in this session (chronological tail)

The session covered a lot. Most recent ~10 commits:

| Commit | Subject |
|---|---|
| `6a9ba84` | polish: accordion as one unified light document; per-gate descriptions in headers |
| `680b67b` | polish: evidence section as 5-gate accordion (all light docs, G4 open) |
| `f59a4ac` | polish: em-dash sweep across all user-facing copy |
| `22a2bb7` | polish: evidence frame as a light document (Gate 4 deep dive) |
| `7160cd6` | polish: add favicon (V mark in accent yellow on dark) |
| `b678b59` | polish: nav "Docs" link → #tools (Inside the framework section) |
| `6ad40ce` | remove(phase-07): drop validate_assumption — generate_test_cards is the prompt |
| `21e9330` | polish: evidence sample — Gate 4 (Pricing) deep dive + cross-gate snippets |
| `c5e725d` | polish: framework section — prompts first + plain-English descriptions |
| `cafa42e` | polish: install section — Claude Desktop only |
| `5074f76` | polish: hide GitHub nav link + rename hero CTA |

Bigger phases shipped: Phase 06 (Brand landing rebuild — 17 commits), Phase 07 (validate_assumption — shipped then UNWOUND in this session because `generate_test_cards` already does what Aljosa actually wanted), Phase 05a (Magic link auth), Phase 04 (Self-serve admin queue), Phase 03 (Multi-tenant HTTPS).

**Heads-up: validate_assumption was shipped (PR #6) then removed in this same session.** `.planning/phases/07-validate-assumption/CONTEXT.md` + `PLAN.md` stay in git as historical record but the code is gone. `generate_test_cards` is the actual "input idea → output hypotheses + experiment designs + pass/fail metrics" prompt — see `src/prompts/generate-test-cards.ts`.

## Common operations

```bash
# Local dev
npm run build         # tsc + chmod + copy schema + generate tools section
npm test              # vitest run, 260 tests
npm run smoke:http    # end-to-end Streamable HTTP smoke (spawns child, 13/13 tools)
npx tsx scripts/assert-fomi-run.ts   # anti-bias regression gate, MUST exit 0
npx tsx scripts/assert-fomi-run.ts --artifact .planning/validation-runs/03-fomi-via-https.md

# HTML validation for landing changes
npx --yes html-validate@9 public/index.html

# In-container admin (token issue / list / revoke)
flyctl ssh console -a vetoed-mcp
# inside:
cd /app && npm run admin -- list-tokens
cd /app && npm run admin -- issue-token --email=alice@example.com
cd /app && npm run admin -- revoke-token pv_<prefix-or-id>

# Live logs
flyctl logs -a vetoed-mcp
flyctl logs --since 5m -a vetoed-mcp | grep -E 'resend_disabled|approval_email_failed|magic_link_email_failed'

# Health + cert
curl -sS https://getvetoed.com/health
flyctl certs check getvetoed.com --app vetoed-mcp

# Manual deploy
flyctl deploy --remote-only --app vetoed-mcp

# PR workflow
gh pr create --base main --head <branch> --title "..." --body "..."
gh pr merge <num> --merge --repo aljosamakevic/devreluni-mcp
gh run list --workflow=deploy.yml --limit 3
gh run watch <run-id> --exit-status
```

## Test credentials (still valid at handoff time)

- **Admin password (local + Fly):** `nD9H3F8EjBFqL884rBpnBFEBv-sHehCn`
- **Test bearer token (issued T-final-3b, still active):** `pv_HxTO10-scbE5yDS6hBJUiVFBWsENRKbl59zKWqIINHY` — bound to `test@vetoed.local`

Both should be considered low-security since they're in this file in the repo. Rotate before going truly public.

## Project conventions (lessons from this session)

- **Atomic commits.** One concern per commit. Subject line starts with phase number or `polish:` / `fix:` / `chore:` etc. Body explains WHY, not WHAT.
- **Build + test green after every commit.** No exceptions.
- **No em dashes in user-facing copy.** Use periods, middle dots (`·`), or pipes (`|`). Em dashes preserved verbatim in the captured Fomi artifact (`.planning/validation-runs/03-fomi-via-https.md`) per spec §10 "don't reinterpret the source." Internal code/HTML/CSS comments untouched.
- **BRAND.md is the source of truth for visual + voice decisions.** Located at repo root. 364 lines. Read sections "Personality," "Color," "Typography," "What NOT to do" before any UI change.
- **No "powerful," "insights," "AI-powered," "discover," "unlock," "supercharge," "game-changer."** BRAND.md forbids these.
- **Verdicts are all-caps:** GO / NO-GO / CONDITIONAL GO / PASS / FAIL / INCONCLUSIVE. Never softened.
- **GitHub nav link is hidden** (repo is private). Restore by uncommenting the line in `public/index.html` `<nav>` block when repo goes public.
- **Old GSD format.** This project predates the `gsd-sdk` CLI. Phases live at `.planning/phases/NN-slug/CONTEXT.md` + `PLAN.md`. No ROADMAP.md, no STATE.md. The official `gsd-add-phase` / `gsd-discuss-phase` skills won't work without the SDK installed — run them manually following the Phase 03 pattern.

## Things I learned NOT to do this session

- Don't put `<div>` or `<p>` inside `<summary>` — html-validate flags it. Use `<span>` with `display: block` / `display: grid` via CSS.
- Don't run `git add -A` — it stages embedded git repos in `.claude/worktrees/` and `.worktrees/`. Always stage specific files.
- Don't change `npm run build` semantics without updating the Dockerfile builder stage to copy any new dependencies (`scripts/` and `public/` are needed at build time as of Phase 06 — see Dockerfile comment).
- Don't trust `dig getvetoed.com` from this machine — local mDNSResponder cache can stay stuck on Namecheap's parking IP for hours. Use `dig @8.8.8.8 getvetoed.com` to bypass.
- Don't trust Node's `dns.lookup()` either — it shares the macOS mDNS cache. For scripts that hit the canonical hostname, use a Node preload that swaps `dns.lookup` for `dns.resolve4` (see `T-final-3b` commit notes — the throwaway `/tmp/dns-bypass.mjs` pattern).

## File map (where things live)

```
/
├── BRAND.md                        # locked v1 visual + voice identity
├── HANDOFF.md                      # this file
├── Dockerfile                      # multi-stage; builder COPYs scripts/ + public/ BEFORE build
├── fly.toml                        # app=vetoed-mcp, region=iad, mounts vetoed_data
├── package.json                    # build script includes tools-section generator
├── public/
│   ├── index.html                  # landing — 1900+ lines, inline CSS + JS
│   ├── favicon.svg                 # V mark, accent yellow on dark
│   └── admin/                      # admin dashboard (Basic-auth gated)
├── src/
│   ├── index.ts                    # entry point + createMcpServer factory
│   ├── http/server.ts              # Express + per-session MCP transport
│   ├── http/magic-link-pages.ts    # success + 4 error page HTML
│   ├── http/admin-api.ts           # admin endpoints
│   ├── http/usage-logger.ts        # res.write/end wrapper for usage_log
│   ├── auth/                       # tokens, middleware, admin-middleware, magic-link, signup-requests
│   ├── ratelimit/                  # per-token, global, signup-ip, magic-link-ip, magic-link-email
│   ├── lib/email.ts                # Resend wrapper, both email templates
│   ├── lib/logger.ts               # pino with redaction
│   ├── lib/cache.ts                # in-process cache, instrumented (D-03-1)
│   ├── lib/serper.ts               # Serper wrapper with global-cap graceful degradation
│   ├── db/                         # schema.sql + connection.ts
│   ├── tools/                      # 13 tool files
│   ├── prompts/                    # 5 prompt files
│   ├── resources/                  # 3 reference markdown files
│   ├── server/prompt-count.test.ts # regression lock at 5 prompts
│   └── validation/                 # PHASE 01 INVIOLATE — do not touch
├── scripts/
│   ├── admin.ts                    # CLI: issue-token / list-tokens / revoke-token
│   ├── smoke-http.ts               # end-to-end MCP client smoke
│   ├── assert-fomi-run.ts          # PHASE 01 INVIOLATE regression gate
│   ├── capture-fomi-via-https.ts   # captures Fomi artifact via live HTTPS
│   ├── run-fomi-via-https.ts       # T-final-3a HTTPS client (placeholder smoke)
│   └── generate-tools-section.ts   # build-time auto-extraction of prompts + tools for landing
├── docs/
│   ├── HOSTED_SETUP.md             # user-facing onboarding
│   ├── OPERATIONS.md               # ops runbook (Fly secrets, admin path, log inspection)
│   └── DNS_SETUP.md                # CNAME + cert setup for getvetoed.com
└── .planning/
    ├── spec/                       # build-spec-v1.0.md + framework-context.md (immutable record)
    ├── codebase/                   # ARCHITECTURE, CONCERNS, CONVENTIONS, etc.
    ├── phases/                     # NN-slug/ per phase, CONTEXT.md + PLAN.md inside each
    └── validation-runs/            # captured Fomi artifacts (regression baselines)
```

## How to resume in a fresh session

1. **Read this file** (you're here). Then `cat BRAND.md` if doing UI work.
2. **Verify state:**
   ```bash
   cd /Users/aljosamakevic/Documents/Buildground/Sandbox/03-devreluni-mcp/devreluni-mcp
   git fetch origin
   git status                    # expect clean working tree
   git log --oneline -5          # expect 6a9ba84 or newer at HEAD
   npm test                      # expect 260 passed
   npx tsx scripts/assert-fomi-run.ts   # expect 6/6 PASS
   ```
3. **Check live:**
   ```bash
   curl -sS https://getvetoed.com/health    # expect 200 + db_ok:true
   ```
4. **Read pending task chips** if the session UI shows any. If `task_2e5f51d3` or `task_dc941873` are still pending, decide whether to dispatch them or keep deferring.
5. **Ask Aljosa what he wants to work on.** Most likely candidates:
   - More landing polish (cheap, fast)
   - Phase 08 OAuth (big, expensive — only if there's a real trigger)
   - Rate limit retune (cheap, fast — only if there's usage data)
   - A new feature he describes

## Open product directions (Aljosa's mental model)

- **Trigger for OAuth:** first user emails asking to pay for more capacity, OR consumer ChatGPT becomes load-bearing for distribution. Until then, magic-link + Claude Desktop is enough.
- **Tier model:** free 400/day, paid (TBD) higher cap. Stripe checkout deferred — waitlist signup is the v1 interest-capture mechanism.
- **No federated identity** (Google/GitHub) in v1. Magic-link is the auth backend for OAuth when it ships.
- **Single region.** Multi-region only if latency complaints emerge.
- **No analytics in landing yet.** Plausible / Umami may come later as a separate small phase.
- **No paid LLM in the loop.** Veto stays MCP-first; users supply Claude (or Cursor, etc.). Frontend-with-live-validator was discussed and explicitly deferred — economics don't work until there's a tier model + Stripe.

---

*Generated by Claude Code session ending 2026-06-15. If something in the codebase contradicts this file, trust the codebase.*
