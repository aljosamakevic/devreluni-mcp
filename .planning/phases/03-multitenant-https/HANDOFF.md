# Phase 03 Handoff — Resume Notes

**Last session ended:** 2026-05-26
**Branch:** `phase-v3` at `12cd8d1` (pushed to remote)
**Build:** green, 70/70 tests passing on `main`
**Reason for handoff:** Context limit on prior Claude session.

---

## Quick state

| | |
|---|---|
| **main** | `76f9987` — Phase 01 + 02 merged, stdio MCP production-ready |
| **phase-v3** | `12cd8d1` — Phase 03 fully PLANNED, not yet executed |
| **PR** | None open yet for Phase 03 |
| **Open spike** | T00 SDK spike running async — findings at `.planning/phases/03-multitenant-https/T00-spike.md` (may already be committed when you resume; check) |

## What's done

- ✅ Phases 01 + 02 shipped to main (PR #2 merged)
- ✅ `stdio-v1` branch tags the pre-Phase-03 state for permanent reference
- ✅ Phase 03 plan complete: 35 tasks across 7 streams in `.planning/phases/03-multitenant-https/PLAN.md`
- ✅ Plan passed two verification rounds; PLAN-CHECK.md v0.2 = PASS-WITH-MINOR-CAVEATS (only minor was the Hono residue in CONTEXT.md, fixed before commit)

## What's pending

1. ~~**T00 spike result** (Hono vs Express)~~ — **DONE.** Recommendation: **Stay with Express. HIGH confidence.** See `.planning/phases/03-multitenant-https/T00-spike.md`. Key finding: MCP SDK ships 5 Express examples + `createMcpExpressApp()` helper; Hono path would require ~7h refactor + force a per-request `McpServer` factory pattern that expands R4 regression risk.
   - **No plan changes needed.** Dispatch `/gsd-execute-phase 03-multitenant-https` directly.
   - **T01 executor MUST crib from** `node_modules/@modelcontextprotocol/sdk/dist/esm/examples/server/jsonResponseStreamableHttp.js` (not the OAuth-heavy `simpleStreamableHttp.js`). It's the closest match to our needs (stateful Express + JSON-response mode, no OAuth).
   - **T01 executor MUST use** `createMcpExpressApp()` from `@modelcontextprotocol/sdk/server/express` (saves ~15 lines, gives free DNS-rebinding protection). Call with `{ host: '0.0.0.0' }` for Fly.
   - **Critical gotcha the executor must not miss:** stateful-mode race condition — write `transports[sid] = transport` inside the `onsessioninitialized` callback, NOT inline before the session is established. See `jsonResponseStreamableHttp.js:84-89` for the SDK author's flagged comment.

2. **User-side prerequisites** before any deploy task lands (Stream D):
   - DNS configured for `getvetoed.com` (CNAME pointed at the Fly app after first deploy)
   - Real email mailbox for landing-page mailto (placeholder: `aljosa@getvetoed.com`)
   - `flyctl auth login` done locally
   - GitHub repo secret `FLY_API_TOKEN` configured
   - Fly volume created: `flyctl volumes create vetoed_data --size 1 --region iad` (documented as T17 prereq)

3. **Stale remote branches** awaiting Aljosa's authorization to delete:
   - `research-v1` (1 stale commit, abandoned)
   - `research-v2` (merged to main, no longer needed)
   - These can stay forever if no one cares, or be cleaned via `git push origin --delete research-v1 research-v2` once Aljosa OKs.
   - Locally these branches were already renamed: `research-v3` → `phase-v3` (active).

## How to resume — step by step

```bash
# 1. Verify state
cd /Users/aljosamakevic/Documents/Buildground/Sandbox/03-devreluni-mcp/devreluni-mcp
git fetch origin
git checkout phase-v3
git pull --ff-only
npm run build
npm test    # 70/70 should pass

# 2. Check the spike result
cat .planning/phases/03-multitenant-https/T00-spike.md
# Read the one-line recommendation. Act on it (see above).

# 3a. If sticking with Express OR switching to Hono with confidence
/gsd-execute-phase 03-multitenant-https

# 3b. If the spike says "tiebreaker — user picks", ask Aljosa first.
```

## Required reading for next-session orchestrator

In order:

1. This file (HANDOFF.md) — current state
2. `.planning/phases/03-multitenant-https/CONTEXT.md` — locked decisions + scope
3. `.planning/phases/03-multitenant-https/PLAN.md` — 35-task plan
4. `.planning/phases/03-multitenant-https/PLAN-CHECK.md` — v0.2 verification (PASS-WITH-MINOR-CAVEATS)
5. `.planning/phases/03-multitenant-https/T00-spike.md` — Hono vs Express finding (if committed by spike agent)
6. `.planning/codebase/CONCERNS.md` — anti-bias surface MUST NOT regress

## Wave dispatch order (from PLAN.md dependency graph)

The plan already documents this but quick reference:

- **Wave 1 (parallel):** T00 spike (if not done), T01 (Express/Hono mount), T05 (db schema), T16 (Dockerfile skeleton), T21 (pino setup), T25 (landing page HTML)
- **Wave 2:** T02 (index.ts refactor), T06 (token storage), T11 (per-token rate limit), T17 (fly.toml), T26 (static serving)
- **Wave 3:** T03 (health endpoint), T07 (auth middleware), T12 (global rate limit), T22 (health DB check), T27 (admin basic-auth)
- **Wave 4:** T04 (smoke), T08-T10 (auth tests + CLI), T13-T15 (rate-limit middleware + tests), T18-T20 (deploy workflow + DNS docs + onboarding), T23-T24 (ops docs), T28-T29 (admin API + JS)
- **Wave 5 (final):** T-final-1 (mark CONCERNS), T-final-2 (pre-flight regression), T-final-3a/3b (HTTPS Fomi run), T-final-4 (assert against new artifact)

## Operational rules to preserve

The Phase 01 + 02 pattern that worked across 80+ atomic commits:
- One agent per 2-5 related tasks
- Atomic commit per task with specific subject lines from the PLAN
- Build + `npm test` after each commit; never commit broken builds
- Tool count probe (13 expected throughout Phase 03; rises only if new MCP tools added — none planned)
- Background agents for parallel waves; foreground for serial dependencies
- Smart deviations OK if documented; never silently change PLAN intent

## Spec-level non-negotiables (DO NOT regress)

- `src/validation/` — Phase 01 validation pipeline. Don't touch.
- `src/lib/bias.ts` — Phase 01 effectiveBias. Don't touch.
- `src/prompts/validate-idea.ts` — Phase 01 JSON-only prompt. Don't touch.
- `src/tools/finalize-validation-report.ts` — Phase 01 finalize tool. Don't touch.
- `scripts/assert-fomi-run.ts` — 6/6 must pass against captured artifacts throughout. Don't loosen assertions to fit failures.
- Stdio transport must keep working when `MCP_TRANSPORT` is unset (the `assert-fomi-run.ts` regression depends on this).

---

*If anything in the codebase contradicts what this HANDOFF.md says, trust the codebase. This file is a snapshot of intent at handoff time.*
