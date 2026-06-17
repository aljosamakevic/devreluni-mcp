# Phase 10 — Severity-weighted verdict + killshot coherence + tool entity-disambiguation

## Phase goal

Close three issues surfaced by a real `validate_idea` dogfooding run (2026-06-17, AI-native focus app):

- **C — existential-gate veto (spec amendment).** The Fail-2 verdict math counts all gate FAILs equally: a single FAIL → CONDITIONAL GO. A hard FAIL on Gate 3 (Platform / Moat Risk — "can a platform or incumbent kill this?") is existential by definition — Apple absorbing the category zeros the company — yet today it is treated as one soft vote and the validator overrides an LLM's NO-GO up to CONDITIONAL GO. Amend the scoring: a Gate 3 FAIL is a **veto**, forcing NO-GO regardless of the count.

- **B — killshot coherence.** `renderer.ts` only renders killshots when `overall === 'NO-GO'`. When the verdict-validator softens a NO-GO (e.g. to CONDITIONAL GO), the model's killshots are **silently dropped** — the single most important reasoning vanishes from the report. Surface them instead of hiding them.

- **D — tool entity-disambiguation.** Two gate tools present keyword-matched noise as signal:
  - `estimate_demand_signals` runs `searchRepos(category)` and counts whatever GitHub returns — for "focus app" that's Quivr (a RAG framework) and Joplin (notes), matched on the word "focus". No relevance filter.
  - `find_public_revenue_signals` matches IndieHackers hits to competitors via raw `haystack.includes(competitor)` — "freedom" the life-goal matches the Freedom app, inflating WTP to "strong".
  A user without skepticism walks away believing a crowded category prints money. Add relevance filtering + honest signal labeling.

## Why this matters

Veto's entire value proposition is "make confirmation bias structurally impossible." C and B are the inverse failure: the *mechanical* layer overriding sound *judgment* (existential risk demoted to a vote) and then hiding the evidence of that risk. D is garbage-in-garbage-out that the verdict text launders into confident-sounding signal. All three undermine trust in the output.

## INVIOLATE authorization

`src/validation/` is Phase 01 INVIOLATE — "must not be modified by any future work without explicit human review" (HANDOFF). **Aljosa explicitly authorized this phase's changes to `src/validation/verdict-validator.ts` and `src/validation/renderer.ts`** (2026-06-17 conversation, AskUserQuestion → "Severity-weight gates too"). This is the required human review. Scope is narrow:
- verdict-validator: ADD an existential-gate veto step; do not alter H4/H4b/H4c/H5 or the Fail-2 math itself.
- renderer: change ONLY the killshot-gating branch so killshots are never silently dropped.
- `scripts/assert-fomi-run.ts` must stay 6/6 PASS after every commit. The captured FOMI artifact is a static markdown file read by the assertion script, not re-rendered — but the verdict-validator unit behavior changes, so its tests are updated and the rendered-output shape is re-verified.

## Architectural decisions (locked with Aljosa 2026-06-17)

1. **Existential gate = Gate 3 (Platform / Moat Risk).** Identified by gate number 3 via a named constant `EXISTENTIAL_GATE_NUMBER = 3`. Rationale: the gate's defining question is "can a platform or incumbent kill this?" — a FAIL there is categorically existential, unlike a FAIL on competition or why-now.

2. **Veto semantics.** After per-gate enforcement and Fail-2 math, if Gate 3 status === FAIL and the computed verdict is not already NO-GO, force NO-GO and emit an `existential_gate_veto` issue. The veto runs BEFORE the decision matrix, so a Fundamental validation-check can still override to INCONCLUSIVE (a broken analysis can't even conclude NO-GO). Order: per-gate → fail-2 → existential-veto → decision-matrix.

3. **Killshot coherence, not deletion.** Killshots are never silently dropped. When `overall === 'NO-GO'`, they render as "Killshot reasons" (unchanged). When the verdict is softened but killshots exist, they render under "Key risks flagged (not verdict-determining)" so the reasoning survives. This is additive to the renderer; no data is mutated.

4. **Tool relevance filtering is conservative — filter, then label honestly.** D does not try to be a perfect entity resolver. It (a) drops obvious off-topic matches (a GitHub repo whose description shares only the single category keyword and nothing else; an IH hit where the only match is a common-English-word competitor token used in a non-product sense), and (b) when the surviving signal is thin, the verdict text says "weak/insufficient" rather than "strong". Over-filtering toward honesty is the correct bias for an anti-bias tool.

## Out of scope

- Re-architecting the Fail-2 rule beyond the single Gate 3 veto (e.g. per-gate weights for all 5 gates). The veto is the minimal, defensible amendment.
- A full entity-resolution / NER layer in the tools. Conservative keyword-relevance filtering only.
- Touching the finalize wrapper, schema, or other INVIOLATE files beyond verdict-validator + renderer.
- The finalize retry-friction (issue A) — it's DX friction, not a defect; deferred.

## Success criteria

| Criterion | Verified by |
|---|---|
| Gate 3 FAIL with only 1 total FAIL → overall NO-GO | C + tests |
| Gate 1 (non-existential) FAIL only → still CONDITIONAL GO | tests |
| Fundamental validation-check still overrides to INCONCLUSIVE even with Gate 3 FAIL | tests |
| Killshots never silently dropped — surfaced under a heading when verdict softened | B + renderer test |
| `estimate_demand_signals` filters off-topic repos (Quivr/Joplin no longer counted for "focus app") | D1 + test |
| `find_public_revenue_signals` does not count "freedom"-the-word as a Freedom-app comparable | D2 + test |
| All existing tests pass; assert-fomi-run 6/6; smoke 13/13; html clean; stdio stdout 0 bytes | regression task |

## INVIOLATE files for this phase

Authorized narrow edits: `src/validation/verdict-validator.ts` (add veto), `src/validation/renderer.ts` (killshot gating only). Everything else in `src/validation/` and `src/lib/bias.ts` stays untouched. The two gate tools (`estimate-demand-signals.ts`, `find-public-revenue-signals.ts`) are not INVIOLATE.
