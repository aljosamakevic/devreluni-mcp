# Phase 11 — Relevance hardening (tool entity-disambiguation, project-wide)

## Phase goal

The 2026-06-17 audit found the entity-disambiguation bug fixed in Phase 10 was a *pattern*, not two instances: 6 more gate tools keyword/substring-match external search results to a competitor/category with no result-side verification, then compute a "strong/structural/high-risk" label from raw hit counts. Two also overclaim "3+ independent sources" while counting snippets from a single query.

Close the pattern everywhere, with a single shared relevance layer.

## Scope

1. **Shared `src/lib/relevance.ts`** (done): `competitorAppears` (proper-noun matcher), `isRelevant` (term/phrase relevance), `buildRelevanceTerms`, `hasWholeWord`, `GENERIC_CATEGORY_TOKENS`. Extracted from the two Phase-10 tools, which now re-export for back-compat. No behavior change for them.
2. **T1 `map_competitive_weaknesses`** (HIGH): gate each weakness signal on `competitorAppears`; compute `is_structural` from **distinct source channels/hosts** (≥3), not raw snippet count; soften the "3+ independent sources" interpretation wording.
3. **T2 `get_category_failure_modes`** (HIGH): gate `FAILURE_PATTERNS` on category co-occurrence, not just a big-tech word; `is_structural` from distinct `products_affected` hosts (≥3); fix verdict wording.
4. **T3 `check_big_tech_encroachment`** (MED): gate conference/API mentions + acquisition hyperscaler attribution on category/feature terms in the snippet.
5. **T4 `find_pricing_anchors`** (MED): require a resolved competitor or the category phrase in the churn snippet before counting a churn signal.
6. **T5 `find_yc_rfs_alignment` / `find_why_now_signals`** (MED): require ≥2 distinct RFS pattern hits before "strong"; don't let an RFS touchpoint alone reach Gate-5 "moderate".
7. **Tests**: `lib/relevance.test.ts`; per-tool gating regressions; a `honest_gap` behavioral test across the 7 emitting tools (the audit found this core anti-bias promise is never behaviorally tested); minimal unit tests for the 8 tools that had zero.

## Design principle

Conservative: when relevance is uncertain, EXCLUDE and report a weaker honest signal. A false "insufficient evidence" is far safer for an anti-bias tool than a false "strong signal". Filtered/excluded counts are disclosed in `confidence_note`.

## Out of scope / non-INVIOLATE

None of these tools are in `src/validation/` — all non-INVIOLATE. The validation-core gaps (V-H2 etc.) are Phase 12.

## Success criteria

- T1–T5 gate their signals through `lib/relevance.ts`; off-topic hits no longer drive "strong/structural" labels.
- T1/T2 "structural" counts distinct sources, and the verdict wording matches.
- `honest_gap` is behaviorally tested for the 7 emitting tools; all 13 tools have at least one unit test.
- All tests pass; assert-fomi 6/6; smoke 13/13; html clean; stdio stdout 0 bytes.
