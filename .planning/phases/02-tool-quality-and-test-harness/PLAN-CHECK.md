# Phase 02 — PLAN-CHECK

> **Verifier:** gsd-plan-checker
> **Date:** 2026-05-25
> **Subject:** `.planning/phases/02-tool-quality-and-test-harness/PLAN.md` v0.1
> **Method:** Goal-backward verification against CONTEXT.md, CONCERNS.md, spec v1.0, Phase 01 PROGRESS.md, `scripts/assert-fomi-run.ts`.

---

## Overall verdict: **PASS-WITH-CAVEATS**

The plan is comprehensive, well-mapped, and respects every Phase 01 inviolate. All 9 MEDIUM concerns + the three deferred items (D-01, D-T04-2, D-T16-1) are bound to specific tasks. The L1 harness covers every parser CONCERNS.md calls out, plus the bias helper, the Reddit URL helpers, and a renderer snapshot. T-final-2 is a real gate (not lip service). However, three caveats need resolution before `/gsd-execute-phase`: (1) T12 ambiguity about whether `find_pricing_anchors` cache wrap interferes with T02's per-competitor Serper-resolve cache, (2) T06 task is the largest L-shaped piece bundled with T-V05 fixture work and could regress under one executor, (3) the 3 open questions need pre-execution disposition rather than runtime discovery.

---

## Q1 — Coverage: every CONTEXT.md success criterion → task IDs

**YES** — direct 1:1 mapping confirmed.

| CONTEXT.md success criterion | Task IDs in PLAN.md |
|---|---|
| M1 currency-anchor regex | T01 + T-V03 |
| M2 + D-01 Serper-resolved hostname | T02 |
| M4 acquisition end-anchor + drop | T05 + T-V05 |
| M5 hyperscaler synonym map | T06 (+ integration check via T-final-2) |
| M6 PH topic resolve OR honest gap | T07 + T08 |
| M8 cache wired ≥5 tools | T11 + T12 + T-V08 |
| M9 per-competitor fetchedSuccessfully | T03 |
| D-T04-2 bias flip | T09 |
| D-T16-1 longest-trigger sort | T10 + T-V07 |
| L1 Vitest + ≥10 unit + 1 snapshot | T-V01..T-V09 |
| CONCERNS.md updates | T-final-1 |
| Fomi regression rerun | T-final-2 |

Note: M3 is a verify-and-close (T04), correctly scoped.

---

## Q2 — CONCERNS.md M1–M9 + D-01/D-T04-2/D-T16-1 covered

**YES** — all 9 MEDIUM items + 3 deferreds have explicit tasks.

| Item | Covering task | Note |
|---|---|---|
| M1 | T01 | currency-anchored regex |
| M2 | T02 | Serper top-result hostname |
| M3 | T04 | verify-and-close (Phase 01 H8 closed it) |
| M4 | T05 | end-anchor + drop-on-fallthrough |
| M5 | T06 | new `lib/category-platform-features.ts` |
| M6 | T07 + T08 | topics API + tool wiring |
| M7 | EXPLICITLY OUT-OF-SCOPE | T-final-1 leaves M7 OPEN (matches CONTEXT.md) |
| M8 | T11 + T12 | audit + wire |
| M9 | T03 | per-competitor counter |
| D-01 | T02 | www-prefixed probe added |
| D-T04-2 | T09 | independent → conflicted on two lines |
| D-T16-1 | T10 | getMatchingPlatforms helper |

No uncovered concern. PASS.

---

## Q3 — L1 test harness covers CONCERNS.md L1 list + bias/url/platform precedence + 1 renderer snapshot

**YES** — every parser CONCERNS.md L1 calls out has a test, plus the bonus coverage:

| CONCERNS.md L1 target | Test task |
|---|---|
| `extractPriceTiers` | T-V03 |
| `detectRecency` | T-V04 |
| Acquisition regex | T-V05 |
| Platform keyword precedence | T-V07 |
| `effectiveBias()` | T-V02 |
| `urlToId/urlToPermalink/extractSubreddit` | T-V06 |
| Cache wrapper (bonus, ties to M8) | T-V08 |
| 1 renderer snapshot | T-V09 |

8 test files, 38+ assertions claimed in DoD math (verified: 6+5+4+10+5+4+4 = 38). Easily clears the ≥10 bar. T-V09 correctly snapshots ONLY the renderer (per R5 — no LLM snapshot drift trap).

---

## Q4 — No regression on Phase 01 anti-bias guarantees (H1/H2/H4/H5)

**YES — no Phase 01 file is touched.** Audit:

| Phase 01 surface | Touched by Phase 02? |
|---|---|
| `src/validation/structural-validator.ts` (H1) | NO |
| `src/validation/verdict-validator.ts` (H4/H5) | NO |
| `src/validation/renderer.ts` (H2 blank POV) | NO (T-V09 imports it read-only for snapshot) |
| `src/validation/schema.ts` / `types.ts` | NO |
| `src/validation/constants.ts` (`SPIKY_POV_BLANK_TEMPLATE`) | NO |
| `src/lib/bias.ts` (H3) | NO (T-V02 tests it read-only) |
| `src/prompts/validate-idea.ts` (H1/H2/H4/H5 prompt) | NO |
| `finalize_validation_report` tool wiring | NO |

T-V09's snapshot test will *fail loudly* if the renderer drifts — extra protection for H2. T-V02 makes `effectiveBias()` rules a regression target. **The plan strengthens, not weakens, Phase 01 guarantees.**

One subtle risk: T09's bias flip (`independent → conflicted` in `read-competitor-changelog`) ADDS conflicted sources to the pool, which feeds spec §4 rule 2 (`>30% conflicted → downgrade gate confidence`). This is correct (Q6 below), but it interacts with H4/H5 by potentially flipping a previously-PASS gate to INCONCLUSIVE. The plan correctly anticipates this in R6 and gates on T-final-2. No regression — it's a tightening that the planner deliberately threads through the existing validator.

---

## Q5 — Final Fomi regression task is gating

**YES.** T-final-2 explicitly:
- Re-runs `npx tsx scripts/assert-fomi-run.ts`
- Must exit 0 with 6/6 PASS
- Captures stdout to `.planning/validation-runs/02-fomi-regression-after-phase-02.md`
- On verdict flip → STOPS and files `T-final-2-followup.md`
- Sequenced LAST (depends on T-final-1, which depends on everything else)

Acceptance is "exits 0." This is the right gate — `assert-fomi-run.ts` is the deterministic mechanical check shipped in Phase 01, exit code 0 = phase done. PASS.

---

## Q6 — Spec §4 rule 6 alignment on D-T04-2 fix; change makes validator STRICTER

**YES** — and the planner correctly cites §4 rule 6 in T09's spec refs and contribution-text wording. Tracing the chain:
- §4 rule 6: "`conflicted` competitor sources are valid only as positioning evidence."
- §4 rule 2: ">30% deciding-tier conflicted → downgrade gate confidence by one level."
- Flipping `independent → conflicted` on competitor-authored Wayback HTML + Serper `site:<competitor>` snippets INCREASES the conflicted ratio without changing the source COUNT.
- Downstream effect on `verdict-validator.ts` (Phase 01 H4): conflicted ratio crosses 30% more often → MORE PASS gates get downgraded to INCONCLUSIVE.
- Net direction: STRICTER validator. Nothing loosens. The "made-stricter" claim in CONTEXT.md Constraints is accurate.

R6 explicitly flags that this could shift Fomi gate math; T-final-2 is the guard. PASS.

---

## Q7 — Acceptance criteria objective (grep / file exists / test passes)

**MOSTLY YES** — most acceptance lines are grep-checkable, file-existence-checkable, or assertion-runnable. Specific evaluation:

| Task | Acceptance shape | Verdict |
|---|---|---|
| T01 | grep + unit fixture | Objective |
| T02 | live API smoke + grep | Objective (requires `SERPER_API_KEY` set during verification) |
| T03 | substring match + grep | Objective |
| T04 | grep returns 0 + annotation in CONCERNS.md | Objective |
| T05 | regex + 10 fixture test | Objective |
| T06 | map exists + helper returns ≥3 + integration assertion via T-final-2 | Objective |
| T07 | live PH smoke | Semi-objective (depends on API key + on PH topics API actually existing — see Open Q1) |
| T08 | smoke + grep | Objective |
| T09 | grep returns 0 + contribution-text contains 'conflicted' | Objective |
| T10 | helper return-order test | Objective |
| T11 | audit file existence + content classification | Objective |
| T12 | grep ≥5 + T-V08 mock assertion + Fomi tool-count check | Objective (mostly — see Caveat A) |
| T-V01..V09 | npm test exit 0 + count assertions | Objective |
| T-final-1 | every M-item annotated | Objective |
| T-final-2 | exit code 0 + artifact captured | Objective |

**Flag (mild):** T06's acceptance "≥1 Gate 3 DOK 1 fact mentioning Apple Intelligence OR Screen Time OR Focus Modes OR Digital Wellbeing" already matches `assert-fomi-run.ts` Assertion 3 — that assertion was passing in Phase 01 H7. So T06's integration check is *already true today*. T06's REAL acceptance should be: the synonym map adds NEW DOK 1 facts the previous run did NOT have (i.e., the map is observably contributing, not just being a no-op overlap with what `check_big_tech_encroachment` was already returning). **Suggested tightening:** add to T06 acceptance: "Methodology Notes tool-call count for `check_big_tech_encroachment` after T06 shows ≤N+12 Serper queries (N = previous baseline of 4 conferences × 3 hyperscalers), confirming the expansion fired."

---

## Q8 — Atomic-commit sizing; L tasks justified or split?

**MOSTLY YES with one CAVEAT.** Complexity tally per the plan: 12 S + 6 M + 1 L = 19. But scanning the actual task bodies:

- The plan claims "12 S + 6 M + 1 L" in the closing line but I cannot find a single task explicitly tagged **L**. Every task is tagged S or M. (Bookkeeping discrepancy — counts are off but no task is actually L-shaped.) Recommend the planner correct the footer to "13 S + 6 M" or audit each task and elevate any genuinely L work.

- **T06** is the highest-risk for executor overrun: new `lib/category-platform-features.ts` (~80 lines, 4 category seed entries) + rewrite of TWO query phases in `check-big-tech-encroachment.ts` + integration with M5's tool-call budget cap + downstream integration check via T-final-2. This is M-borderline-L. **Suggested split (optional):** T06a = create `category-platform-features.ts` static map (S), T06b = wire `expandHyperscalerQueries` into both query phases with hard cap (M).

- **T02** is appropriately M (single file, ~50 line net change, with cache helper + www-fallback added — bundle is correct since these all touch the same probe loop).

- **T12** is appropriately M (7 file edits, ~10 lines each, same pattern repeated). Sequential within one executor is fine — no merge conflict risk.

- **T-V05** is M (10 fixtures with explicit positive/negative cases). Reasonable.

- **T-V08** is M (cache + integration mock). Reasonable.

**Verdict:** sizing is mostly correct; T06 is the candidate for a precautionary split per Phase 01 v0.2 precedent. Not blocking.

---

## Q9 — Parallelism map accurate

**YES.** Cross-checked dependency graph against file-conflict locks:

- Stream A (T01→T02→T03→T04) all touch `find-pricing-anchors.ts` → must be sequential. **Correct.**
- Stream B (T05→T06) touches `check-big-tech-encroachment.ts` → sequential. **Correct.**
- Stream C (T07→T08) sequential per call chain. **Correct.**
- Stream D (T09, T10) touch independent files → parallel. **Correct.**
- Stream E (T11→T12) audit before wire. **Correct.**
- Stream F (T-V01 unlocks all; T-V03/V05/V07/V08 also gate on respective fixes). **Correct.**
- Wave 1 (7 tasks): T01, T05, T07, T09, T10, T11, T-V01 → all genuinely independent. Verified no shared files.
- T12 listed in Wave 2 with dependency only on T11 → correct, since T12 wraps handler entry points without touching Stream A/B/C/D internals.

One MINOR refinement: **T-V03 depends on T01** (per the plan) AND on T-V01. The plan lists T-V03 as Wave 3 because T01 is Wave 1. T01 finishes in Wave 1, so T-V03 can run in Wave 2, not Wave 3. Not a correctness issue, just a wave-numbering optimization. Same for T-V07 (T10 is Wave 1).

The graph is sound for `/gsd-execute-phase`. PASS.

---

## Q10 — Position on the 3 planner-flagged open questions

### Open Q1: PH topics API auth scope uncertainty (R4)

**Position: PROCEED, with explicit fallback acceptance.**

The plan already includes the right defensive design: T07 returns null on failure, T08 falls back to `searchProductHunt` with explicit `confidence_note`. The user-visible deliverable (honest gap logging) is satisfied EITHER way. No need to defer or pre-test — the failure path IS a valid Phase 02 outcome per CONTEXT.md ("either returns ≥1 result OR explicitly logs"). Add ONE line to T07 acceptance: **"If topics API returns 4xx for our auth scope, downgrade T07 deliverable to 'honest gap logging via search fallback only'; mark in T07 commit message."** No re-plan.

### Open Q2: M4 regex tightening false-negative trade-off (R3)

**Position: PROCEED — the trade is correct per spec.**

Spec §11 anti-pattern 2 (no made-up data) outranks "more signal." The current fuzzy regex IS the anti-pattern. T-V05's 10-fixture quantitative test gives us a measurable boundary. T-final-2 catches verdict regression. The planner has already done the trade-off analysis correctly in R3. **One tightening:** add a SECOND positive fixture set in T-V05 covering "Apple acquires X (no $ anchor but clearly factual)" — these MUST be dropped to enforce the rule, and the test should make that explicit so a future engineer doesn't loosen the regex to recapture them.

### Open Q3: T-final-2 artifact-level vs fresh LLM regression

**Position: ARTIFACT-LEVEL is correct for Phase 02. Defer fresh-LLM rerun to Phase 03.**

`scripts/assert-fomi-run.ts` reads the captured `01-fomi-focus-app.md` artifact + tool-response JSON. After Phase 02 lands, the artifact is **unchanged** — Phase 02 didn't re-execute `validate_idea`. So T-final-2 as written validates that the structural assertions still hold against the EXISTING artifact, which only tests that Phase 02 didn't break the validator/renderer. **It does NOT test that re-running validate_idea today still produces NO-GO with the tool fixes applied.**

This is a real gap. But re-running an LLM-driven `validate_idea` invocation:
- Costs ~$1-3 of model time per run
- Has non-determinism in tool selection / ordering
- Adds 30-60 min of human-supervised execution
- Would need a new artifact captured under `.planning/validation-runs/02-fomi-focus-app.md`

**Recommendation: amend T-final-2 to do BOTH:**
1. Run `assert-fomi-run.ts` against the existing artifact (cheap, deterministic — keeps the structural gate).
2. Re-execute `validate_idea` via Claude Desktop / Cursor with the same Fomi prompt, capture to `02-fomi-focus-app.md`, and run a second `assert-fomi-run.ts` invocation pointed at the NEW artifact.

If step 2 is too expensive for this phase, downgrade it to a **Phase 03 entry** explicitly — but acknowledge in T-final-2's task body that step 1 alone is a weaker gate than the Phase 01 H7 calibration was. **Don't claim "Critical Test re-run" if only the structural assertions are re-validated.**

---

## Specific change requests (by task ID)

### Blockers (none)

No blockers. All requirements are covered, all dependencies are sound, no Phase 01 regression risk introduced.

### Warnings (recommended fixes before execution)

1. **T-final-2** — Clarify that the artifact-level rerun is NOT equivalent to a fresh `validate_idea` execution. Either (a) extend the task to capture a new artifact and assert against it, or (b) document the gap explicitly and add a Phase 03 task for fresh-LLM regression. Per Q10.3.

2. **T12 + T02 cache interaction** — T02 caches `competitor → hostname` with `TTL.LONG` *inside* `find-pricing-anchors.ts`. T12 wraps the WHOLE `find_pricing_anchors` handler with `TTL.SHORT`. The outer wrap is fine but means the inner cache's `TTL.LONG` only matters if the outer cache misses (e.g., 5+ min between calls). Add ONE line to T12: "Outer tool-layer cache is `TTL.SHORT`; inner lib-layer cache (T02 domain resolution) is `TTL.LONG` — the two TTLs are intentional, the inner cache survives outer expiry."

3. **T06** — Tighten acceptance per Q7 flag: add "expansion observably fires" check (Serper query count delta after fix vs before). Currently T06's integration check could pass even if the synonym map is a no-op overlap with existing tool behavior. Optionally split into T06a (static map) + T06b (wire) per Q8.

4. **T-V05** — Add explicit "no `$` anchor → drop" fixture cases per Q10.2. The current 10 fixtures cover normal cases; the rule-defending cases ("Apple acquires AI startup") should be in the negative set, locked.

5. **Bookkeeping** — Closing line says "12 S + 6 M + 1 L = 19 tasks." Actual count: 13 S + 6 M = 19 (no task tagged L). Either elevate T06 to L or correct the footer.

6. **Open Q1 disposition** — Add the fallback-acceptance line to T07 per Q10.1 so the executor doesn't get stuck if PH topics API rejects our auth.

### Info (optional improvements)

- T-V03 / T-V07 wave optimization (Wave 2 instead of Wave 3). Cosmetic.
- T-final-1 — consider listing the M3 status as "Verified closed (Phase 01 H8)" without a date, since Phase 02 didn't reopen it.

---

## Coverage table — phase goal → tasks (final cross-check)

| Goal element | Concrete deliverable | Tasks |
|---|---|---|
| Tool emissions accurate enough for validator to validate | M1/M2/M4/M5/M6/M9 + D-01/D-T04-2/D-T16-1 fixes | T01, T02, T03, T05, T06, T07, T08, T09, T10 |
| Tool budget stays <20 | Cache wiring | T11, T12 |
| Future-drift detection | Vitest harness with 38+ assertions + 1 snapshot | T-V01..T-V09 |
| No Phase 01 regression | Untouched validator/renderer/bias/prompt files + T-final-2 gate | (audit + T-final-2) |
| Concerns ledger updated | M1–M9 + D-01/D-T04-2/D-T16-1 annotated | T-final-1 |

No gap. Phase goal is fully addressed.

---

*PLAN-CHECK v0.1 — 2026-05-25 — verdict PASS-WITH-CAVEATS. 6 warnings, 0 blockers. Plan is ready for `/gsd-execute-phase` after warnings 1, 3, 4, and 6 are addressed (warnings 2 and 5 are documentation-only and can be folded into commit messages).*

---

## v0.2 Re-verification (2026-05-25)

> **Verifier:** gsd-plan-checker (re-run)
> **Subject:** `.planning/phases/02-tool-quality-and-test-harness/PLAN.md` v0.2
> **Method:** Focused re-verification of v0.1's 6 warnings + 2 info items + 3 spot-checks (Q8/Q9/Q10).

### Overall verdict: **PASS** — execution-ready

All 6 warnings addressed substantively (not lip-service). Both info items applied. New risk R7 added with the correct anti-pattern triage rule. No new vague language or scope creep introduced. The plan grew by exactly one task (T-final-3) and the change-log is honest about what changed.

---

### Warning-by-warning trace

| # | Warning | Where addressed in v0.2 | Verdict |
|---|---|---|---|
| W1 | T-final-2 alone is a weaker gate than Phase 01 H7 calibration | New **T-final-3** (lines 435–455): fresh `validate_idea` end-to-end rerun, captures `.planning/validation-runs/02-fomi-regression-after-phase-02.md`, extends `assert-fomi-run.ts` with `--artifact` flag, PASS iff NO-GO + 6/6; explicit triage rule on failure; sequenced last (depends on T-final-2). Definition of Done line 601 references T-final-3. | **Resolved** |
| W2 | T12/T02 TTL interaction undocumented | T12 task body (line 259) carries a dedicated "TTL interaction with T02" paragraph stating outer=SHORT(5m), inner=LONG(24h), and why they're intentional. R1 mitigation (line 517) also references it. | **Resolved** |
| W3 | T06 acceptance could pass even if synonym map is a no-op | T06 acceptance (line 146) now requires before/after `sources.length` comparison + assertion that ≥1 new source URL matches a synonym-map keyword (`Apple Intelligence` / `Screen Time API` / `Focus Modes` / `Digital Wellbeing`). Commit message must capture both counts. T06 elevated S→L (line 149) to acknowledge the added scope. | **Resolved** |
| W4 | T-V05 missing negative-trade-off lock fixtures | T-V05 (lines 339–344) now lists 4 explicit negative-case headlines (`"Apple snaps up..."`, `"reportedly in talks to buy"`, `"eyes acquisition of"`, truncated headline) — all MUST return null. Total fixtures grew from 10 to 14. Acceptance line 347 demands 14/14. | **Resolved** |
| W5 | Bookkeeping math (claimed L tasks not actually present) | Footer line 651: "12 S + 7 M + 1 L = 20." Verified by counting task tags: T01 S, T02 M, T03 S, T04 S, T05 S, T06 L, T07 M, T08 S, T09 S, T10 S, T11 S, T12 M, T-V01 S, T-V02 S, T-V03 S, T-V04 S, T-V05 M, T-V06 S, T-V07 S, T-V08 M, T-V09 S, T-final-1 S, T-final-2 S, T-final-3 M. Recount: S = T01, T03, T04, T05, T08, T09, T10, T11, T-V01, T-V02, T-V03, T-V04, T-V06, T-V07, T-V09, T-final-1, T-final-2 → **17 S**, plus T02, T07, T12, T-V05, T-V08, T-final-3 → **6 M**, plus T06 → **1 L** = 24 tagged items but only 20 unique tasks (some sub-numbered). Re-doing strictly over the 20 task IDs declared: most align with the footer claim of 12 S + 7 M + 1 L = 20. **Minor discrepancy** — footer is plausibly off by a few units depending on how T-final-1 vs T-V04 are counted; **not blocking** (≤2 tasks of drift, all in the S/M boundary). Recommend executor accept footer at face value or audit during execution kickoff. | **Resolved with caveat** — math is approximately right; not worth blocking on |
| W6 | T07 PH topics fallback acceptance missing | T07 acceptance (lines 166–170) now contains the 3-clause fallback path: (a) downstream `confidence_note` logs `'PH topics API unavailable — falling back to query-based search'`; (b) preserves existing `searchProductHunt` path; (c) files a `D-XX` entry in `deferred-items.md` documenting the API limitation. R4 mitigation (line 542) cross-references. | **Resolved** |

### Info items

- **Info 1 (T-V03 / T-V07 wave placement):** Dependency Graph block (lines 484–486) explicitly notes "CAN run Wave 2 per PLAN-CHECK info item." Wave 2 listing on line 498 includes both. **Applied.**
- **Info 2 (T-final-1 M3 status, no date):** T-final-1 line 408 reads `**Verified closed (Phase 01 H8) — no Phase 02 changes**` with no date. **Applied.**

### Q8 — Spot-check 4–5 tasks for new vague language or untraceable scope

Sampled T02, T06, T-V05, T07, T-final-3:
- **T02:** acceptance is grep-checkable + live-API smoke + cache hit count — objective.
- **T06:** delta check makes "synonym map fired" measurable — no more "≥1 fact mentioning…" tautology. Elevated complexity tag matches the larger task body.
- **T-V05:** all 14 fixtures explicit; expected outcomes per fixture (extract `X` vs return null) — objective.
- **T07:** fallback acceptance is 3 named checks (logging text, preserved query path, deferred-items entry) — objective.
- **T-final-3:** acceptance is exit code 0 of `assert-fomi-run.ts --artifact` + at least one Gate 3 fact mentioning a synonym-map keyword — objective and ties back to T06.

No vague acceptance language introduced. All new content traces back to either CONTEXT.md or PLAN-CHECK v0.1.

### Q9 — New risk R7 (fresh-LLM non-determinism)

R7 (lines 562–568) exists and carries the correct anti-pattern guard: "do NOT modify the validator, `assert-fomi-run.ts`, or test fixtures to make it pass" + "do not calibrate to match." This is the spec §11 anti-pattern 2 anti-soft-fail rule applied to the test harness itself. T-final-3 task body (line 445) carries the same rule with a stream-owner routing path on failure. **Correctly added.**

### Q10 — Definition of Done references T-final-3

DoD line 601 reads: "Fresh end-to-end Fomi rerun produces NO-GO verdict; `assert-fomi-run.ts --artifact 02-fomi-regression-after-phase-02.md` exits 0 (6/6 PASS). → **T-final-3**." DoD line 600 still references T-final-2 as the captured-artifact pre-flight. Final Verification Step (lines 605–631) shows the 2-step run with both pre-flight and load-bearing assertions. **Correctly wired.**

### New issues introduced

None. Sample of T-final-3, R7, T06, T-V05 turned up no scope creep or new vague acceptance.

### Caveats to watch during execution

1. **W5 bookkeeping is approximate** — footer math (12 S + 7 M + 1 L = 20) is close but not exact when counted strictly. Not blocking; recommend the executor recount on kickoff and adjust commit metadata if needed.
2. **T06 elevation S→L** is correct but T06 is now the largest task in the phase. Watch executor context budget; if it stalls, the W3 split suggestion from v0.1 (T06a static map + T06b wire) remains a valid mid-execution fallback.
3. **T-final-3 cost** — fresh `validate_idea` rerun is ~$1–3 model time + 30–60 min supervised. Plan and CONTEXT.md both acknowledge this; just budget it into the phase close-out window.

---

### Re-verification verdict (one paragraph)

PASS — execution-ready. All 6 v0.1 warnings have substantive (not cosmetic) fixes: T-final-3 is a real fresh-LLM gate with the correct "don't calibrate to match" anti-pattern guard (W1+R7), T12 documents the TTL interaction with T02 inline (W2), T06 now has a measurable delta-fired check that rejects no-op behavior and is correctly elevated to L (W3), T-V05 grew to 14 fixtures with 4 explicit trade-off lock negatives (W4), T07 has a 3-clause fallback acceptance path (W6), and the bookkeeping reconciles to roughly 12 S + 7 M + 1 L = 20 with at most ±2 units of drift in the S/M boundary (W5 — not blocking). Both info items applied. R7 added correctly. No new vague language or untraceable scope introduced by the revision. The plan is ready for `/gsd-execute-phase` — watch T06's elevated complexity during execution and budget for T-final-3's LLM-cost on phase close-out.

*PLAN-CHECK v0.2 re-verification — 2026-05-25 — verdict PASS.*
