# Veto — Session handoff

**Date:** 2026-06-17
**Author:** Aljosa + Claude (Claude Code, Opus 4.8 [1M])
**Why this doc exists:** captures every load-bearing fact a fresh session needs to be useful immediately. If anything in the codebase contradicts this doc, trust the codebase; this is a snapshot of intent at handoff time.

> **Previous handoff was 2026-06-15 at commit `6a9ba84`.** This session (2026-06-17) shipped Phases 08–14 — see "What shipped this session." All deployed to prod.

---

## Quick state

| | |
|---|---|
| **Repo** | `aljosamakevic/devreluni-mcp` (GitHub, private) |
| **Working dir** | `/Users/aljosamakevic/Documents/Buildground/Sandbox/03-devreluni-mcp/devreluni-mcp` |
| **Default branch** | `main` |
| **Latest commit at handoff** | `e38daef` (fix(oauth): serve metadata at RFC 9728 path-suffixed + openid-config paths) |
| **Live URL** | `https://getvetoed.com` (Let's Encrypt, cert valid through 2026-08-24; auto-renews via Fly) |
| **Fallback URL** | `https://vetoed-mcp.fly.dev` |
| **Build status** | green (365 tests pass, `assert-fomi-run.ts` 6/6 PASS) |
| **Deploy status** | live, main deployed at `e38daef`, prod `/health` = ok |

## What's deployed (unchanged infra from 2026-06-15)

- **Hosting:** Fly.io app `vetoed-mcp`, region `iad`. Multi-stage Dockerfile (Node 22 bookworm-slim). SQLite (`better-sqlite3`, WAL) on persistent volume `vetoed_data` at `/data`.
- **CI:** `.github/workflows/deploy.yml` on push to `main` → tests → build → `flyctl deploy --remote-only`.
- **Fly secrets:** `RESEND_API_KEY`, `ADMIN_PASSWORD`, `SERPER_API_KEY`, `PRODUCTHUNT_API_KEY`, `GITHUB_TOKEN`. **Fly env:** `MCP_TRANSPORT=http`, `PORT=3000`, `VETOED_DB_PATH=/data/vetoed.db`, `BASE_URL=https://getvetoed.com`.
- **Email:** Resend, `getvetoed.com` verified, from `Veto <noreply@getvetoed.com>`.

---

## What shipped this session (2026-06-17) — Phases 08–14

All triggered by real `validate_idea` dogfooding that surfaced a recurring **model-rationalization anti-pattern** (see Lessons). Each phase deployed + verified on prod.

- **Phase 08 — finalize-report DX.** Registered the `resource://report-schema` resource (JSON Schema + minimal-valid skeleton + worked example, via `zod-to-json-schema`) that the `validate_idea` prompt referenced but never existed. Enriched the `finalize_validation_report` failure envelope with `expected_skeleton` + per-issue `hints[]`. Prompt now mandates loading the resource before constructing JSON. → **4 resources now** (was 3).
- **Phase 09 — tool envelope status discriminator.** Every tool response now carries `status: 'ok' | 'honest_gap' | 'error'` (+ optional `error: {code,message}`). `honest_gap` = ran cleanly, found nothing (the anti-bias gap signal); models must not read it as a failure. Helpers in `src/lib/envelope.ts`. Prompt forbids confabulating infra causes.
- **Phase 10 — severity-weighted verdict + tool entity-disambiguation.** **Gate 3 (Platform/Moat) FAIL now vetoes the overall verdict to NO-GO** regardless of the fail-2 count (existential gates don't get a soft vote). Renderer never silently drops killshots. Demand/revenue tools disambiguate entities (Quivr≠"focus", "freedom"≠Freedom app). **INVIOLATE override — user-authorized.**
- **Phase 11 — relevance hardening.** Extracted `src/lib/relevance.ts` (`competitorAppears`, `isRelevant`, `buildRelevanceTerms`); applied gating across 6 more tools; fixed the "3+ independent sources" overclaim to count **distinct hosts**, not snippets.
- **Phase 12 — validation-core integrity (INVIOLATE, user-authorized).** V-H2 enforce killshots cite real DOK1 URLs; V-M1 sync `gate_summary.reason` on override; V-M2 pin gate-3 identity; V-M4 Source-Quality-Audit depth advisory. First dedicated `structural-validator` vitest.
- **Phase 13 — auth hardening.** Magic-link **claims atomically before minting** (one link → one token; `claimMagicLink` + `recordConsumedToken`); PII (email) dropped from unauthenticated verify logs; usage-logger routed through pino.
- **Phase 14 — full OAuth 2.1 bundle (built on `feat/oauth`, merged once verified end-to-end).** veto is now its own OAuth 2.1 AS + Resource Server so it can be added as a **claude.ai custom connector**.

Also: `fix(logger)` pino→stderr (stdio stdout stays clean for JSON-RPC); `fix(ratelimit)` global Serper cap **fails open when the DB is unavailable** (local stdio); onboarding surfaces hand out the `mcp-remote` config shape for Claude Desktop.

**Audit:** `.planning/codebase/AUDIT-2026-06-17.md` — whole-project audit; most findings now fixed, remainder noted there.

---

## Phase 01 INVIOLATE — status after this session

These files encode the anti-bias property:
- `src/validation/` (entire directory) · `src/lib/bias.ts` · `src/prompts/validate-idea.ts` · `src/tools/finalize-validation-report.ts`

**`src/validation/` and `validate-idea.ts` WERE modified this session — with explicit human authorization** (Aljosa, via AskUserQuestion, for the Phase 10 veto and Phase 12 integrity work). Authorized changes:
- `verdict-validator.ts`: existential Gate 3 veto + killshot synthesis + `gate_summary.reason` sync.
- `renderer.ts`: surface (never drop) killshots on softened verdicts.
- `structural-validator.ts`: V-H2/M2/M4 checks.
- `validate-idea.ts`: status-field + report-schema + calling-convention guidance (Step 1/Step 7 only).

**The rule still holds for the next session:** do NOT modify `src/validation/*` without fresh explicit human review. `scripts/assert-fomi-run.ts` must exit 0 (6/6 PASS) after every commit — it stayed green through all of the above. (It reads a static artifact at `.planning/validation-runs/03-fomi-via-https.md`, so validator code changes don't move it; verify by re-running, not by assuming.)

---

## Architecture summary (updated)

### MCP entities
- **13 tools** (one per `src/tools/*.ts` minus tests). Order load-bearing (`assert-fomi-run` counts invocations).
- **5 prompts** (validate_idea, steelman_against, run_single_gate, generate_test_cards, quick_kill_check). Locked by `src/server/prompt-count.test.ts`.
- **4 resources** (source-tier-bias, tool-to-gate-map, evaluation-lens-matrix, **report-schema** [new, built fresh per read]).
- **Tool response envelope** (`src/types.ts` `ToolResult<T>`): `{ status, data, sources, confidence_note, fallbacks_used, error? }`. Build via `src/lib/envelope.ts` (`okResult`/`honestGapResult`/`errorResult`) — never hand-roll.
- **Relevance gating** (`src/lib/relevance.ts`): all external-search tools route entity/category matching through it. Conservative — exclude + report weak signal rather than launder noise.

### Verdict math (spec + Phase 10 amendment)
Order in `verdict-validator.ts`: per-gate source/bias rules → fail-2 math → **existential Gate 3 veto** → validation-check decision matrix. A Gate 3 FAIL forces NO-GO; a Fundamental validation-check still overrides to INCONCLUSIVE.

### Auth + signup (updated)
- **Static bearer (unchanged):** `pv_<base64url-32>`, sha256 in `tokens.token_hash`. `authRequired` validates. Claude Desktop uses `mcp-remote` shim (see `docs/HOSTED_SETUP.md` §2) — the `{ url, headers }` shape is NOT accepted by Claude Desktop; hand out the `command: npx mcp-remote` shape.
- **Magic-link self-serve:** `POST /auth/magic-link/request` → email → `GET /auth/magic-link/verify` mints a bearer. Now **claim-before-mint** (one-time-use is atomic).
- **OAuth 2.1 (NEW, live, additive):** veto is its own AS+RS. OAuth access tokens are normal `pv_` tokens minted into `tokens`, so `authRequired` validates OAuth + static identically. Endpoints in `src/http/oauth-routes.ts`, storage/PKCE in `src/auth/oauth.ts`. Magic-link is the human login step inside `/authorize`.

### Rate limits (updated)
- **Per-user** (`src/ratelimit/per-user.ts`, `PER_USER_LIMIT=400`/24h) — counts across ALL of a user's tokens (so OAuth refresh can't multiply quota). Middleware prefers per-user when an email is bound, falls back to per-token.
- **Global Serper:** 1,500/UTC-day, graceful degradation; **fails open if the DB can't be opened** (local stdio) — does NOT disable the hosted cap (verified).

### HTTP surface (new/changed rows)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/.well-known/oauth-protected-resource[/mcp]` | none | RFC 9728 (also openid-configuration alias) |
| GET | `/.well-known/oauth-authorization-server[/mcp]` | none | RFC 8414 |
| POST | `/register` | none | Dynamic Client Registration (RFC 7591) |
| GET | `/authorize` | none | OAuth 2.1 + PKCE → magic-link login |
| POST | `/authorize/login` | none | email → magic link |
| GET | `/oauth/callback` | none | magic-link verify → auth code → 302 to client |
| POST | `/token` | none (PKCE) | authorization_code + refresh_token grants |
| GET/POST | `/account/upgrade` | none | waitlist (no payment), per-IP capped |
| POST | `/mcp` | Bearer | 401 now carries `resource_metadata=...` |

---

## OPEN ITEMS (start here next session)

1. **claude.ai connector still not connecting.** Server is provably healthy (TLS valid, `GET /mcp`→405, `POST /mcp`→401 in ~200ms with `resource_metadata`, DCR returns a valid client, full handshake passes in tests + live HTTP). **But Fly logs show ZERO requests from claude.ai across every attempt** — no `/.well-known`, `/register`, `/authorize`, `/token`, or `/mcp`. So claude.ai lists the connector but never initiates the connection/OAuth flow. The fix is on the claude.ai side: **remove → re-add the connector → click Connect → complete the Veto email sign-in.** Diagnostic question for the user: *did a Veto sign-in/authorize prompt ever appear?* To debug a fresh attempt: `flyctl logs -a vetoed-mcp` and watch for `oauth_authorize_login` / `oauth_code_issued` / `oauth_token_issued` events — if none appear, claude.ai isn't reaching the server.
2. **`estimate_demand_signals` oversized-output bug.** On some categories (e.g. "event marketing automation") the tool returns >340K chars (huge GitHub repo list) and the MCP client rejects it as too large → the tool effectively errors. Fix: cap/trim the repo payload (it already filters off-topic repos for the *signal*, but still returns the full list in `data`). Low effort, real bug. Not yet filed as a phase.

---

## Active queue (task chips)

1. **`task_dc941873` — Phase 08 OAuth + per-user limits + waitlist UI.** ✅ **DONE this session** (Phase 14). If still showing pending in the UI, dismiss it.
2. **`task_2e5f51d3` — Tune per-token + global rate limits.** Partially addressed: per-token replaced by **per-user** (400/day). Global Serper still 1,500/UTC-day. Revisit thresholds when real usage data exists; update `docs/HOSTED_SETUP.md` if changed.

---

## Common operations

```bash
# Local dev
npm run build          # tsc + chmod + copy schema + generate tools section
npm test               # vitest run (365 tests)
npm run smoke:http     # end-to-end Streamable HTTP smoke (13/13 tools)
npx tsx scripts/assert-fomi-run.ts   # anti-bias regression gate, MUST exit 0 (6/6)
npx --yes html-validate@9 public/index.html

# Verify stdio stdout stays clean (must be 0 bytes — JSON-RPC channel)
( node build/index.js > /tmp/o.log 2>/dev/null & P=$!; sleep 1; kill $P; wait ); wc -c < /tmp/o.log

# OAuth live check against prod
curl -sS https://getvetoed.com/.well-known/oauth-protected-resource
curl -sS -X POST https://getvetoed.com/register -H 'content-type: application/json' -d '{"client_name":"x","redirect_uris":["https://claude.ai/cb"]}'

# In-container admin / logs / deploy
flyctl ssh console -a vetoed-mcp          # then: cd /app && npm run admin -- list-tokens
flyctl logs -a vetoed-mcp
flyctl deploy --remote-only --app vetoed-mcp
gh run watch <run-id> --exit-status

# PR/merge: OAuth-style risky work → branch, verify e2e, merge --no-ff, deploy.
```

## Test credentials (low-security, rotate before truly public)

- **Admin password (local + Fly):** `nD9H3F8EjBFqL884rBpnBFEBv-sHehCn`
- **Test bearer token (active):** `pv_HxTO10-scbE5yDS6hBJUiVFBWsENRKbl59zKWqIINHY` — bound to `test@vetoed.local`. Used against prod this session; works.

---

## Project conventions (carried + new)

- **Atomic commits**, build + test + `assert-fomi-run` green after every commit. Commit body explains WHY. Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **No em dashes in user-facing copy** (BRAND.md). Verdicts all-caps (GO/NO-GO/CONDITIONAL GO/PASS/FAIL/INCONCLUSIVE).
- **BRAND.md is the source of truth** for visual + voice. Forbidden words: powerful, insights, AI-powered, discover, unlock, supercharge, game-changer.
- **Don't `git add -A`** — stages embedded git repos in `.claude/`/`.worktrees/`. Stage specific files. (`.claude/`, `.worktrees/`, `coverage/` are untracked and expected.)
- **Old GSD format** — manual phases at `.planning/phases/NN-slug/` (CONTEXT.md + PLAN.md). No SDK; `/gsd-*` skills run manually following the Phase 03 pattern.
- **OAuth / production auth = branch-first.** Build on a feature branch, verify end-to-end (unit + live HTTP), merge `--no-ff`, deploy as one unit. Never half-ship an auth flow to main.

## Lessons from this session (important — read before trusting a bug report)

- **The model-rationalization anti-pattern.** A calling LLM hit four "failures" this session and each time confabulated a plausible-but-wrong infrastructure cause: "schema isn't publicly documented," "MCP server is timing out," "two tools can't open their database," "fetch through an artifact → NetworkError." Every one was either a real bug with a *different* root cause or a wrong assumption — **verified against logs/code, not the model's narration.** Discipline: when a model (or this doc) claims a cause, reproduce it against `flyctl logs` / the code before believing it. This is literally the bias Veto exists to prevent, applied to its own operation.
- **`honest_gap` ≠ failure.** Empty tool results are a finding (the status discriminator exists precisely so models stop reading "no data" as "broken").
- **Claude Desktop rejects the `{ url, headers }` MCP shape** — use the `mcp-remote` `command/args` shape. claude.ai (remote connector) uses OAuth, not a pasted token.
- **stdio stdout is the JSON-RPC channel** — anything written to it (a stray pino line, an oversized payload) corrupts the client. Logger writes to stderr.

---

## File map (new files this session marked ✨)

```
src/
├── types.ts                         # ToolResult now has status + error discriminator
├── lib/
│   ├── envelope.ts          ✨      # okResult / honestGapResult / errorResult
│   ├── relevance.ts         ✨      # competitorAppears / isRelevant / buildRelevanceTerms
│   ├── logger.ts                    # pino → STDERR (fd 2)
│   └── serper.ts                    # global cap fails open when DB unavailable
├── resources/
│   └── report-schema.ts     ✨      # buildReportSchemaResource() + MINIMAL_VALID_SKELETON
├── auth/
│   ├── oauth.ts             ✨      # AS storage, DCR, PKCE codes, refresh rotation
│   ├── waitlist.ts          ✨      # addToWaitlist
│   └── magic-link.ts                # + claimMagicLink / recordConsumedToken
├── ratelimit/
│   └── per-user.ts          ✨      # checkPerUserLimit (cross-token, by email)
├── http/
│   ├── oauth-routes.ts      ✨      # all OAuth 2.1 endpoints + /account/upgrade
│   ├── server.ts                    # mounts registerOAuthRoutes
│   └── usage-logger.ts              # error path via pino
├── validation/                      # INVIOLATE — Phase 10/12 changes (authorized)
│   ├── verdict-validator.ts         # existential veto + killshot synth + reason sync
│   ├── structural-validator.ts      # V-H2/M2/M4
│   └── renderer.ts                  # killshots surfaced, not dropped
└── db/schema.sql                    # + oauth_clients/codes/refresh/authorize_requests, waitlist

.planning/
├── codebase/AUDIT-2026-06-17.md ✨  # whole-project audit (prioritized backlog)
└── phases/08..14-*/             ✨  # CONTEXT.md + PLAN.md per phase
```

## How to resume

1. Read this file. `cat BRAND.md` for UI work. Skim `.planning/codebase/AUDIT-2026-06-17.md` for the remaining backlog.
2. Verify: `git status` (clean), `git log --oneline -3` (expect `e38daef`), `npm test` (365), `npx tsx scripts/assert-fomi-run.ts` (6/6), `curl -sS https://getvetoed.com/health`.
3. **Most likely first task:** the claude.ai connector (Open Item #1 — operational, on the claude.ai side) or the `estimate_demand_signals` oversized-output bug (Open Item #2 — a real, small code fix).
4. Remaining audit backlog (AUDIT doc): mostly closed; check the "Recommended next phases" section for anything deferred.

---
*Generated by Claude Code session ending 2026-06-17 (Opus 4.8 [1M]). If the codebase contradicts this file, trust the codebase.*
