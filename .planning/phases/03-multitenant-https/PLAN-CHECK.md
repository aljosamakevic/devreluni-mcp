# Phase 03 PLAN Check — `gsd-plan-checker`

> **Checker run:** 2026-05-26
> **Plan reviewed:** `.planning/phases/03-multitenant-https/PLAN.md` v0.1 (33 tasks)
> **Source-of-truth files:** CONTEXT.md, build-spec-v1.0.md §1, Phase 02 PLAN/PROGRESS, `scripts/assert-fomi-run.ts`, `package.json`
> **Stance:** Adversarial (FORCE). Plan starts disqualified; verdict requires evidence.

---

## Overall verdict: **PASS-WITH-CAVEATS**

Plans cover all 19 CONTEXT.md success-criterion checkboxes and explicitly carve Phase 01/02 files out of scope. The auth, rate-limit, and observability designs are honest about race windows, redaction, and timing-attack mitigation. Several concrete caveats below need fixes before execution; most are surgical edits to acceptance criteria, not re-planning.

---

## Q1 — Coverage: every CONTEXT.md success criterion maps to specific task IDs?

**YES.** Plan's own §"Goal-Backward Verification" table (lines 35–56) provides the mapping; spot-check confirms each row is real:

| CONTEXT.md success criterion | Tasks (cross-checked) | OK? |
|---|---|---|
| HTTP boot on :3000 | T01, T02 | YES |
| curl tools/list end-to-end | T01, T04 | YES |
| Stdio still works | T02, T-final-2 | YES |
| 401 + `WWW-Authenticate: Bearer realm="vetoed"` | T07, T08, T10 | YES |
| admin CLI (issue/list/revoke) | T05, T06, T09 | YES |
| 429 + Retry-After per-token | T11, T13, T15 | YES |
| 429 + global Serper warning | T12, T13, T15 | YES |
| usage_log per-token | T05, T14 | YES |
| Fly.io deploy | T16, T17, T18 | YES |
| getvetoed.com DNS resolves | T19 (doc + user action) | YES |
| /health JSON | T03, T22 | YES |
| 70 tests still pass + new ≥90 | T10, T15, T-final-4 | YES |
| Fomi via HTTPS NO-GO | T-final-3, T-final-4 | YES |
| docs/HOSTED_SETUP.md | T20 | YES |
| Landing page at / | T25, T26 | YES |
| Admin dashboard at /admin | T27, T28, T29 | YES |
| CONCERNS.md updated | T-final-1 | YES |
| pino redaction | T21 (+ R6 smoke in T-final-4) | YES |
| Fly metrics docs + secrets rotation | T23, T24 | YES |
| Branch nomenclature `phase-v3` → `main` | T-final-1 | YES |

**Minor coverage gap (WARNING):** CONTEXT.md success criterion "`list-tokens` shows last 4 chars only" — plan stores `token_prefix` as **first 7 chars** (`pv_a1b2c`), not last 4. Both are grep-able; first-7 is arguably better. Reconcile: either update CONTEXT.md to "first-7" or change T06 to compute both prefix and suffix. Recommend updating CONTEXT.md (first-7 is more useful for grep since `pv_` is the discriminator).

---

## Q2 — Phase 01 + 02 non-regression: does any task touch `src/validation/`, `src/lib/bias.ts`, `src/prompts/validate-idea.ts`, `src/tools/finalize-validation-report.ts`?

**NO.** Audited every task's `Files:` line. Zero references to:
- `src/validation/` (not touched)
- `src/lib/bias.ts` (not touched)
- `src/prompts/validate-idea.ts` (not touched)
- `src/tools/finalize-validation-report.ts` (not touched)

Plan explicitly asserts this inviolate constraint at lines 27 and 154. PASS.

**One adjacent file (`src/lib/serper.ts`) is modified** by T12 to wire `checkGlobalSerperLimit` + `recordSerperCall`. CONTEXT.md does not list `serper.ts` in the "untouched" set, and the §7 graceful-degradation behavior is explicitly preserved (return stub data, push `fallbacks_used`, downgrade source tier). Defensible — not a regression.

---

## Q3 — Stdio non-regression preserved?

**YES with one tightening needed (WARNING).** T02 acceptance (lines 103–106) covers all three branches: unset → stdio, `=http` → HTTP, garbage → exit 1. T-final-2 (lines 650–662) explicitly re-runs `assert-fomi-run.ts` against the captured Phase 02 artifact (`02-fomi-regression-after-phase-02.md`, which exists at that path — confirmed). R4 risk explicitly called out (line 816).

**WARNING:** T02 acceptance says "Existing Claude Desktop config + `assert-fomi-run.ts` still work" — but does NOT specify which captured artifact to test against. Add an explicit verify step to T02 acceptance: `npx tsx scripts/assert-fomi-run.ts` (default arg = Phase 01 artifact at `01-fomi-focus-app.md`) should exit 0 immediately post-T02 commit, BEFORE proceeding to T03. Currently the regression catch happens only at T-final-2, which lands after 30+ tasks of intervening change.

---

## Q4 — Auth correctness

### Q4a — 401 includes `WWW-Authenticate: Bearer realm="vetoed"` header?
**YES.** T07 (line 227): "401 + `WWW-Authenticate: Bearer realm="vetoed"` header". T08 verifies the exact string (`grep -nF 'Bearer realm="vetoed"' ... returns exactly 1 match`). T10 uses `.toBe('Bearer realm="vetoed"')` exact-string. PASS.

### Q4b — Token format is `pv_<base64>`?
**YES.** T06 (line 209): `pv_<base64url-32bytes>` via `crypto.randomBytes(32).toString('base64url')`. CONTEXT.md "Not optional" honored. PASS.

### Q4c — Admin auth (Basic) is separate from bearer-token auth?
**YES.** T27 uses `src/auth/admin-middleware.ts` with `Authorization: Basic`. T07's `authRequired` middleware is wired to `POST /mcp` ONLY (T07 lines 232–233 explicit). T27 wires `adminAuthRequired` to `/admin*` only. They are different middlewares, different realms, different schemes. The admin path is NOT vulnerable to bearer tokens because the bearer middleware is not applied there. PASS.

**WARNING:** T27 says "Username is fixed to `"admin"`" but the `crypto.timingSafeEqual` check is described only for the **password**. The username equality check (`req.user === "admin"`) must also be constant-time — or, more practically, normalize by always running `timingSafeEqual` over the full `<user>:<password>` concatenation against `"admin:" + ADMIN_PASSWORD`. Add an explicit acceptance line to T27 forbidding plaintext `===` comparison on username/password.

**WARNING (high):** T27 reads `process.env['ADMIN_PASSWORD']` directly on every request inside the middleware. If `ADMIN_PASSWORD` is unset (e.g., misconfig on first deploy), the comparison succeeds against empty string when client sends empty password. Add explicit acceptance: middleware MUST return 500 (not 401) if `ADMIN_PASSWORD` is unset, refusing to serve `/admin*` until the secret is configured. Otherwise an unset env var silently allows anonymous admin access.

---

## Q5 — Rate-limit correctness

### Q5a — Per-token math (20 validate_idea/day → 260 tool calls/day)?
**YES, math is right and documented.** T11 (lines 299–303) derives `20 * 13 = 260 tool calls / 24h / token` and justifies tool-call-level enforcement: "the MCP server cannot observe a 'prompt invocation' — prompts are LLM-side orchestration." Documented in file-header per T11 acceptance. PASS.

**WARNING:** The "13 tool calls per validate_idea" figure comes from spec §11 DoD ("<20 tool calls per validate_idea"). 13 is a typical, not maximum. A spec-compliant validate_idea can fire up to ~19 tool calls. At 19 × 20 = 380 tool calls/day, the 260 threshold cuts off legitimate runs around 13.7 runs/day, not 20. Plan should either (a) raise the limit to 400 to align with the spec UPPER bound, or (b) document the trade-off explicitly in the T11 file-header comment and in `docs/HOSTED_SETUP.md` (T20) so users understand "20 runs/day" is a rough estimate, not a contract.

### Q5b — Global Serper cap in `src/lib/serper.ts` instead of middleware — defensible?
**YES, defensible.** T13 (line 332) is explicit: "the middleware does NOT pre-check the global limit, because not every tool call uses Serper." This is correct — placing it in middleware would 429 tools that don't touch Serper (e.g., `read_competitor_changelog` which uses GitHub API). The graceful-degradation path (T12 lines 318–319: return stub data + push `'global rate limit'` to `fallbacks_used`) preserves spec §7 §11 anti-pattern 2.

**WARNING:** Putting the cap inside `serper.ts` means the HTTP layer cannot return a 429 with `Retry-After` for global-cap events — instead, the response is a normal 200 with stubbed data and a `fallbacks_used` entry. CONTEXT.md success criterion says "Requests exceeding global rate limit return 429 + log structured warning." This is a **subtle CONTEXT.md contradiction**: 429 implies the HTTP layer rejects, but the plan instead degrades gracefully at the tool layer. Both behaviors have merit; pick one:

- **Option A (plan's current path):** keep degradation at tool layer; update CONTEXT.md success criterion to "global cap → structured `fallbacks_used` entry + structured warning log (no 429 because cap fires mid-tool-call after auth/rate-limit middleware already passed)."
- **Option B:** also expose a `/admin/api/serper-status` or have middleware pre-check the global cap and 429 the *next* request after the cap was first hit. More complex.

Recommend Option A; T-final-1 captures the CONTEXT.md edit as a D-XX entry.

### Q5c — 429 includes `Retry-After`?
**YES.** T13 (line 331): "429 + `Retry-After: <sec>` header + JSON body". T15 tests verify. PASS.

### Q5d — Race condition called out (CONTEXT.md R5)?
**YES.** T12 (line 326): explicit file-header comment about the small race window. R5 in plan §Risks (lines 824–831) documents the 1–2 extra calls/day acceptable leakage and links it to the 200-call headroom inside the 1,500 cap. PASS.

---

## Q6 — Secrets hygiene

### Q6a — `ADMIN_PASSWORD` redacted in pino logs?
**YES.** T21 redact list (lines 487–491) includes `ADMIN_PASSWORD` substring matches and `*.authorization` paths. R6 smoke test in T21 acceptance + T-final-4 checklist verifies via `grep -F hunter2` returns ZERO matches. PASS.

### Q6b — API keys read from Fly secrets, never committed?
**YES.** T17 (line 422): `grep -nE "SERPER_API_KEY|ADMIN_PASSWORD" fly.toml` returns ZERO matches. T24 documents `flyctl secrets set` for all 4 secrets. PASS.

### Q6c — `crypto.timingSafeEqual` for password comparison?
**YES.** T27 line 582 explicit. PASS. (See Q4c WARNING about constant-time username handling.)

---

## Q7 — Deployment realism

### Q7a — Dockerfile uses Node 22? Multi-stage?
**YES.** T16 lines 384–385: `FROM node:22-bookworm-slim AS builder` + `AS runtime`. Multi-stage. `node:22-bookworm-slim` is the right base for `better-sqlite3` prebuilt binaries. PASS.

**WARNING:** T16 line 387 excludes `scripts/` from the production container via `.dockerignore` ("admin scripts ship via `flyctl ssh` access to the source repo, not the container"). But T24's secrets-rotation runbook references `flyctl ssh console` → `npm run admin -- revoke-token <prefix>`. If `scripts/admin.ts` is not in the container, this command fails on the production host. Either:
- Include `scripts/admin.ts` in the container (small footprint, fixes the runbook), OR
- Document that admin CLI runs via `flyctl proxy` to the production DB from Aljosa's laptop only (T20 already mentions this; T24 needs to match).

Fix T16 and/or T24 to align — currently contradictory.

### Q7b — fly.toml has persistent volume mount?
**YES.** T17 line 407 + R2 mitigation. Volume `vetoed_data` → `/data`. PASS.

### Q7c — DNS step explicitly a USER action?
**YES.** T19 (line 446) is a doc, not an automated task. CONTEXT.md item explicitly: "T19 (DNS docs) — requires user action; doc is the deliverable" (line 46). PASS.

### Q7d — `FLY_API_TOKEN` repo secret setup called out?
**YES.** T18 line 441: "commit message documents the user-action requirement to add this secret in GitHub repo settings before first deploy." PASS.

**WARNING:** The Phase requires a one-time `flyctl volumes create vetoed_data --size 1` before first deploy (R2 mitigation, line 806). This is an out-of-band step that is only documented in the R2 mitigation prose, NOT as an acceptance line in T17 or T18. Add an explicit acceptance to T17: "Commit message documents the one-time `flyctl volumes create vetoed_data --size 1` step that must be run by Aljosa before first deploy."

---

## Q8 — Acceptance criteria objective?

**Mostly YES — flag 5 vague spots:**

| Task | Vague phrase | Recommended fix |
|---|---|---|
| T01 (line 87) | "Code comment cites the verified SDK API surface" | Acceptance is "comment contains the literal string `StreamableHTTPServerTransport` constructor + Express mount pattern verified against SDK version `<X.Y.Z>`". |
| T19 (line 458) | "Includes the exact `flyctl certs add` command" | Acceptance: `grep -F 'flyctl certs add getvetoed.com' docs/DNS_SETUP.md` returns ≥1 match. |
| T25 (line 558) | "renders cleanly, no broken layout" | Acceptance: HTML parses via `npx html-validate public/index.html` exit 0; no broken `<a>` tags (`grep` for `href=""`). |
| T29 (line 623) | "Manual smoke (T-final-4 includes a checklist item)" | Acceptance is hand-wavy — but T-final-4 line 707 lists the precise checklist item. OK as-is, document the back-reference. |
| T-final-1 (line 646) | "any D-03-XX entries that actually surfaced during execution" | Add minimum: at least the D-XX entries flagged below in Q10 (CONTEXT.md global-cap shape, Q5b) MUST be entered. |

---

## Q9 — Atomic-commit sizing (L tasks justified?)

L-complexity tasks: T01, T-final-3. Plan summary at the end claims "13 S + 14 M + 6 L"; spot-counting: I count S=12, M=15, L=6 (T01, T11 has been resized to M, etc.). The headline "L=6" appears slightly off — only 2 L tasks are explicitly tagged L in the body (T01, T-final-3). Other Ls are probably miscounted in the summary; not a blocker.

**WARNING (one L task bundles 2 deliverables):** T-final-3 includes BOTH (a) writing `scripts/run-validate-idea-via-https.ts` (~80 lines new code) AND (b) capturing the artifact + verifying verdict. These are atomic-separable: split into T-final-3a (build the script + smoke against `<app>.fly.dev`) and T-final-3b (run against `getvetoed.com` + capture artifact). Smaller commits, cheaper rollback if the script has bugs. Not required, but recommended.

T01 is justifiably L — it's the foundation, and the R1 mitigation explicitly says scope expansion is fine here.

---

## Q10 — Disposition on the 5 planner-flagged open questions

The planner's plan does not call out a numbered "open questions" section, but the operator question lists 5. Disposition:

### OQ1 — T01 SDK API surface for Express + StreamableHTTPServerTransport
**Decide via prototype in T01 itself; do not defer, do not re-plan.** T01 is correctly scoped as foundation with explicit prototype-first acceptance (lines 75, 85–88). R1 mitigation (lines 789–796) documents the contingency: if Express needs glue, T01 expands within its L budget. **No plan change needed.** Optional risk-reducer: spend 30 min with Context7 on `@modelcontextprotocol/sdk` Streamable HTTP examples BEFORE starting T01 to de-risk the prototype.

### OQ2 — T-final-3 against `<app>.fly.dev` vs `getvetoed.com` fallback
**Accept the fallback.** R3 mitigation (lines 808–814) is correct: DNS propagation can take 15min–24h, and the verdict (NO-GO) is what matters, not the hostname. The fallback is already documented. **Recommend tightening T-final-3 acceptance to make the fallback explicit:** "Acceptance passes against `https://<app>.fly.dev/mcp` if `dig getvetoed.com CNAME` has not yet propagated; capture artifact filename remains `03-fomi-via-https.md`; a T-final-3-redo task is filed for the post-propagation rerun."

### OQ3 — `bin.weather` in package.json
**Confirmed present** at `package.json` line 7–8: `"bin": { "weather": "./build/index.js" }`. This is a Phase 00 / scaffold leftover (the SDK starter template's name). **Defer to Phase 04.** It's not blocking; Claude Desktop configs use the path directly, not the bin name. Phase 03 has enough scope already. Add a D-03-X entry in T-final-1 noting the deferred rename.

### OQ4 — Fly app name `vetoed-mcp` placeholder
**Confirm or change BEFORE T18 ships, not at planning time.** The placeholder is fine for T17 (line 402: "user can rename pre-deploy"). User action required: pick the final name before running `flyctl launch` for the first time. T17 acceptance should note: "Aljosa confirms final app name pre-`flyctl launch`; if changed from `vetoed-mcp`, update `fly.toml` + `docs/DNS_SETUP.md` CNAME target in the same commit."

### OQ5 — Real email for landing-page mailto
**Needed from user before T25 ships.** T25 line 551 uses placeholder `mailto:aljosa@example.com`. This is BLOCKING for T25's commit message but not for the task body — Aljosa can supply the real email when T25 is in flight. Add an explicit acceptance: "T25 commit replaces `aljosa@example.com` with Aljosa's real intake email; no `example.com` references survive in `public/index.html`."

---

## Specific change requests (must apply before execute)

| ID | Severity | Task | Change |
|---|---|---|---|
| C1 | BLOCKER | T27 | Add acceptance: middleware returns 500 (not 401) if `process.env['ADMIN_PASSWORD']` is unset/empty. Otherwise unset env var silently allows admin access. |
| C2 | BLOCKER | T27 | Use `crypto.timingSafeEqual` over the FULL `user:pass` string (not password alone) to avoid leaking username validity timing. Acceptance: forbid plaintext `===` comparison on credentials. |
| C3 | BLOCKER | T16 / T24 | Reconcile: T16 excludes `scripts/` from container but T24 runbook calls `npm run admin` via `flyctl ssh`. Either include `scripts/` in container OR rewrite T24 to use `flyctl proxy` from Aljosa's laptop only. |
| C4 | BLOCKER | T17 | Add acceptance: commit message documents the one-time `flyctl volumes create vetoed_data --size 1` user-action prereq. |
| C5 | WARNING | T02 | Add acceptance: post-commit run of `npx tsx scripts/assert-fomi-run.ts` (default artifact) exits 0 — don't defer regression catch to T-final-2. |
| C6 | WARNING | T11 | Document that 260 tool calls/day ≈ 13.7 spec-max-budget runs/day, not 20. Either raise threshold to 400 or document the trade-off in HOSTED_SETUP.md (T20). |
| C7 | WARNING | CONTEXT.md | Reconcile global-cap shape: plan does graceful-degradation at tool layer, CONTEXT.md says "429". Pick one (recommend Option A: keep degradation; update CONTEXT.md). Capture as D-03-X in T-final-1. |
| C8 | WARNING | T06 | Reconcile prefix shape: CONTEXT.md says "last 4 chars only"; plan stores first-7. Recommend updating CONTEXT.md to "first-7 (`pv_xxxxx`)" — better for grep. |
| C9 | WARNING | T-final-3 | Split into T-final-3a (build script + smoke) + T-final-3b (capture artifact). Atomic-rollback friendly. |
| C10 | INFO | T01 | Add acceptance: SDK version captured in the verified-API-surface comment (e.g., `@modelcontextprotocol/sdk@<X.Y.Z>`). |

---

## Verdict summary

**PASS-WITH-CAVEATS.** The plan is structurally sound: every CONTEXT.md success criterion has a covering task, Phase 01/02 inviolate files are untouched, R1–R8 risk register is honest, and the regression gate (T-final-2 + T-final-4) is the right shape. The main blockers are surgical hardening of the admin-auth path (C1, C2 — unset env var + constant-time comparison), reconciling the admin-CLI runbook with the Docker exclusion (C3), and an unstated volume-create prereq (C4). The warnings reflect real tensions worth resolving (global-cap shape, per-token threshold math, regression catch timing) but none of them re-route the plan. Apply C1–C4 as blockers, fold C5–C9 into task acceptance edits, and execute.


---

## v0.2 Re-verification (2026-05-26)

> **Re-checker run:** 2026-05-26 against `PLAN.md` v0.2 (35 tasks) + CONTEXT.md surgical edits.
> **Stance:** Adversarial. Verify each v0.1 disposition landed; surface any new issues introduced by the rewrite.

| # | Point | Result | Evidence (line refs into PLAN.md unless noted) |
|---|---|---|---|
| 1 | C1 — T27 admin middleware fail-closed (HTTP 500, not 401/200) on unset/empty/<12 char `ADMIN_PASSWORD`? | **YES** | T27 Step 1 (lines 652) + acceptance (line 666): "returns **HTTP 500** ... Explicitly NOT 200, explicitly NOT 401" + supertest unit test required. |
| 2 | C2 — `crypto.timingSafeEqual` over full `user:pass`; `===`/`==` forbidden on credentials? | **YES** | T27 Step 3 (line 656): single Buffer compare over full `user:pass`. Acceptance (line 667): `grep -nE "===\|=="` on credential vars returns ZERO; `timingSafeEqual` count = exactly 1. |
| 3 | C3 — T16 Dockerfile includes `scripts/`; `.dockerignore` does NOT exclude it; T24 documents `flyctl ssh console` → `npm run admin`? | **YES** | T16 (line 430): "**`scripts/`** (per C3 reconciliation)" + `.dockerignore` note "Do NOT exclude `scripts/`" (line 432). T16 acceptance line 440-441 asserts `docker run ... ls scripts/admin.ts` succeeds + admin CLI invocable in-container. T24 (lines 594, 602): canonical path documented, `grep -F 'flyctl ssh console -a vetoed-mcp'` returns ≥1. |
| 4 | C4 — `flyctl volumes create vetoed_data --size 1 --region <region>` documented as one-time prereq in T17 commit body AND `docs/OPERATIONS.md` (T23)? | **YES** | T17 acceptance (lines 470-481): verbatim commit-message block with the exact command. T23 (line 578 + acceptance line 586): `grep -F 'flyctl volumes create vetoed_data' docs/OPERATIONS.md` ≥1 match required + "First-time-prereqs section appears BEFORE metrics". |
| 5 | C5 — T02 acceptance runs `assert-fomi-run.ts` post-commit (no deferral to T-final-2)? | **YES** | T02 acceptance (line 134): "**(C5)** **Immediate non-regression catch:** after the T02 commit lands, the executor runs `npx tsx scripts/assert-fomi-run.ts` (default artifact ...) and confirms **exit code 0** ... Commit message documents the exit code." |
| 6 | C6 — Per-token threshold raised/justified with explicit 400-call math (20 runs × 20 calls spec-max = 400; typical ~260)? | **YES** | T11 (lines 325, 331-343): threshold = **400**, file-header math block verbatim documents "Worst case ... 400 / day", "Typical ~260", "20 spec-max runs/day guarantee". T20 (line 528): user-facing "400 tool calls / day / token" required phrase. |
| 7 | C7 — Global cap = graceful degradation in `serper.ts` (NOT 429); CONTEXT.md updated; T12/T15 aligned? | **YES** | T12 (lines 362, 368): "No 429 ... 429 reserved for per-token". T15 (line 413): explicit graceful-degradation test "does NOT throw / does NOT return a 429". CONTEXT.md lines 29 + 135 both rewritten to "graceful degradation at `src/lib/serper.ts` ... No 429". |
| 8 | C8 — Token prefix = first 7 chars (`pv_xxxxx`); plan + CONTEXT.md consistent? | **YES** | T05 schema comment (line 193): "first 7 chars (e.g. \"pv_a1b2c\") — see CONTEXT.md D-03-2". T06 (line 237, acceptance line 248): `grep -nE "substring\(0,\s*7\)\|slice\(0,\s*7\)"` ≥1 required. T09 (line 284) prints first-7-char prefix. CONTEXT.md line 137: "**first 7 chars (`pv_xxxxx`)**". |
| 9 | C9 — T-final-3 split into T-final-3a (build script + placeholder smoke) and T-final-3b (live run + artifact)? | **YES** | T-final-3a (lines 747-766): builds `scripts/run-fomi-via-https.ts`; acceptance is placeholder-URL smoke + connection-error non-crash. T-final-3b (lines 768-800): live endpoint, captures `03-fomi-via-https.md`, verdict NO-GO, word count ≥4000, DNS-fallback to `vetoed-mcp.fly.dev` allowed. |
| 10 | C10 — T01 file-header captures verified `@modelcontextprotocol/sdk@<X.Y.Z>` + entry point? | **YES** | T01 acceptance (lines 106-115): verbatim file-header block with SDK version comment + grep gate `grep -nE "@modelcontextprotocol/sdk@[0-9]+\.[0-9]+\.[0-9]+" src/http/server.ts` ≥1 match — forces literal version capture. |
| 11 | OQ1–OQ5 disposed (T00 optional spike, T-final-3b fly.dev fallback, OQ3-5 as D-03-X)? | **YES** | T00 added (lines 75-89), optional spike with 30-min timebox. T-final-3b acceptance line 797 records endpoint per OQ2. T-final-1 (lines 715-722) lists D-03-1, D-03-1-a, D-03-2, D-03-3, D-03-4, D-03-5, D-03-6 (OQ3) + acceptance `grep -E "D-03-(1\|1-a\|2\|3\|4\|5\|6)"` ≥6 matches. OQ4 confirmed in T17 (line 482). OQ5 mailto in T25 (line 617, acceptance 628). |
| 12 | No new issues in v0.2-touched tasks (T00, T01, T02, T06, T09, T11, T12, T15, T16, T17, T20, T23, T24, T27, T-final-3a, T-final-3b, T-final-4)? | **YES** (with one micro-note, see verdict) | Spot-checked T00 (clear timebox, non-blocking), T11 math block, T12 race-window doc, T16 `tsx`-in-deps note, T27 fail-closed test, T-final-3b NO-GO triage rule. Acceptance criteria are concrete and grep-enforceable throughout. No vague "code review confirms..." language introduced. One sub-blocker: see point 15. |
| 13 | Changelog `v0.2 — addressed PLAN-CHECK.md (...)` present at bottom of PLAN.md? | **YES** | Lines 1094-1111 explicit changelog block covering C1–C10 + OQ1–OQ5 + new R9. |
| 14 | CONTEXT.md edits surgical (only global-cap + token-prefix sections touched)? | **YES** | Decision 2 (lines 26-31) rewritten for graceful degradation + 400 tool-call math. Success criteria lines 135 (global cap shape) + 137 (first-7 prefix) updated. Auth model, hosting, scope, constraints all intact. |
| 15 | Stream B's Hono reference (CONTEXT.md line 79) — caught? | **NO — residual** | `grep -i "hono"` in CONTEXT.md finds **3 stale references**: line 79 ("B4: Hono middleware `authRequired`"), line 172 ("need to add `hono`"), line 176 ("Hono docs ... middleware patterns, context API"). All contradict locked Decision 6 (line 51: "HTTP framework = Express"). The PLAN.md itself is Express-clean (T07 says "Express `authRequired` middleware"), so the contradiction is **CONTEXT.md-internal**, not plan-vs-context. Severity: **WARNING** (cosmetic/operator-confusion risk; PLAN is the executable artifact and is correct). |

---

### New issues introduced by v0.2

| ID | Severity | Where | Issue | Fix |
|---|---|---|---|---|
| C11 | WARNING | CONTEXT.md lines 79, 172, 176 | Residual Hono references contradict locked Decision 6 (Express). Plan is Express-correct, but a future operator reading CONTEXT.md alone could be misled. | One-line surgical edits: line 79 "Hono middleware" → "Express middleware"; line 172 drop `hono`; line 176 drop "Hono docs" reading entry. Not blocking execution — the PLAN executes against Express. |

### Re-verification verdict

**PASS-WITH-MINOR-CAVEATS** — execution-ready.

All 4 v0.1 blockers (C1–C4) closed with concrete acceptance lines. All 5 warnings (C5–C9) folded in. Info item (C10) applied with grep-enforced version capture. All 5 open questions disposed cleanly. The plan's atomic-commit shape held across the rewrite; no goal-backward coverage gap was introduced. Changelog is honest about scope of changes.

**Tasks to watch during execution:**
- **T00 / T01:** the optional-spike → foundation seam. If T00 is skipped and T01 exceeds its L budget, the R9 fallback ("run T00 retroactively") must be honored, not papered over.
- **T11:** 400-tool-call threshold is now stricter on aggregate behavior. The sliding-window SQL must exclude `status='rate_limited'` (locked by T15 test). Watch for the sliding-window-excludes-stale-rows test actually being written.
- **T16:** `tsx` move from devDeps → deps is required for `npm run admin` in-container. If T16 ships without this, T24's runbook silently breaks at first execution.
- **T27:** the fail-closed semantics + timing-safe comparison are security-critical. Code review must confirm exactly ONE comparison site and zero credential `===`/`==` paths.
- **T-final-3b:** the DNS fallback is explicit, but the artifact MUST record which endpoint was used. Don't let the executor forget the frontmatter field.

**Residual CONTEXT.md cleanup (C11, WARNING-only):** three stale Hono references in CONTEXT.md (lines 79, 172, 176) contradict the locked Express decision. Surgical fix recommended but does not block execution because the PLAN itself is unambiguously Express.

