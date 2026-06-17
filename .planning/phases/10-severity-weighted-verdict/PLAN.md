# Phase 10 — PLAN

> **Author:** Claude (Opus 4.8 [1M]) + Aljosa, 2026-06-17
> **CONTEXT basis:** `.planning/phases/10-severity-weighted-verdict/CONTEXT.md`
> **Style template:** Phase 08/09 PLAN.md

## Inviolate constraints
- assert-fomi-run 6/6 PASS after every commit.
- src/validation/* untouched EXCEPT verdict-validator.ts (add veto) + renderer.ts (killshot gating) — user-authorized.
- 13 tools / 5 prompts / 4 resources unchanged in count.

## Tasks (atomic commits)

### T01 — Scaffold (this CONTEXT + PLAN)
Commit: `docs(10): scaffold severity-weighted verdict phase`

### T02 — D1: relevance filter in estimate_demand_signals
Files: `src/tools/estimate-demand-signals.ts`
A GitHub repo counts toward the demand signal only if its `full_name`+`description` overlaps the category on more than the single matched token (≥2 category tokens, or a token other than the most-generic one). Off-topic repos are dropped from `top_repos` consideration for the signal-strength calc (still surfaced raw in data with a flag, or excluded). Verdict text recomputed from filtered counts.
Commit: `fix(tools): filter off-topic GitHub repos from demand signal`

### T03 — D2: entity disambiguation in find_public_revenue_signals
Files: `src/tools/find-public-revenue-signals.ts`
Replace raw `haystack.includes(competitor)` with a stricter match: word-boundary match AND reject when the competitor token is a common English word (e.g. "freedom", "forest", "brick", "opal") unless it co-occurs with a product cue ("app", "MRR", "$", "revenue", category term). Generic-category-only hits are not counted as named paid comparables. Verdict downgrades "strong" → "weak/insufficient" when surviving named comparables are few.
Commit: `fix(tools): disambiguate competitor names in revenue signals`

### T04 — C: existential Gate 3 veto (INVIOLATE, authorized)
Files: `src/validation/verdict-validator.ts`
Add `EXISTENTIAL_GATE_NUMBER = 3` + `applyExistentialVeto(gates, fail2Verdict, issues)`: if gate 3 status === FAIL and fail2Verdict !== 'NO-GO', return 'NO-GO' and push an `existential_gate_veto` issue. Wire into verdictValidate between computeFail2 and applyDecisionMatrix.
Commit: `feat(verdict): Gate 3 platform FAIL vetoes to NO-GO (spec amendment)`

### T05 — B: killshot coherence (INVIOLATE, authorized)
Files: `src/validation/renderer.ts`
NO-GO → "Killshot reasons" (unchanged). Else if killshots.length > 0 → render under "Key risks flagged (not verdict-determining)". Never silently drop.
Commit: `fix(renderer): surface killshots instead of dropping on softened verdict`

### T06 — Tests
Files: new `src/validation/verdict-validator.test.ts`, extend `src/validation/renderer.test.ts`, new/extend tool tests.
- veto: Gate3 FAIL + 1 fail → NO-GO; Gate1 FAIL only → CONDITIONAL GO; Gate3 FAIL + Fundamental check → INCONCLUSIVE (matrix still wins).
- renderer: killshots present on CONDITIONAL GO → "Key risks flagged" section present.
- demand: a synthetic off-topic repo is excluded from signal.
- revenue: "freedom" common-word hit not counted as comparable.
Commit: `test(10): veto + killshot coherence + tool relevance`

### T07 — Regression + deploy
npm test, assert-fomi-run, smoke:http, html-validate, stdio stdout check. Push → CI → prod /health.

## Risk register
| Risk | Mitigation |
|---|---|
| Veto changes the captured FOMI verdict | assert-fomi reads a static artifact; the AI-native-focus FOMI is already NO-GO with Gate 3 FAIL → veto reinforces, not changes. Verify after each commit. |
| Veto interacts wrongly with Fundamental-check INCONCLUSIVE | Veto runs before decision matrix; matrix INCONCLUSIVE still wins. Covered by a test. |
| Over-filtering tools to zero signal | Conservative filter + honest "insufficient" labeling is the intended bias; tests assert legit signal survives. |
| Renderer change alters assert-fomi grep targets | assert-fomi checks killshot presence on a NO-GO artifact; NO-GO path unchanged. |
