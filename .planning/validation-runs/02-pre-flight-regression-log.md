# 02 — Pre-flight Regression Log (T-final-2)

**Date:** 2026-05-25
**Repo commit count at run time:** 61 total (HEAD = `f813547` T-final-1)
**Phase 02 commit count (this phase):** ~22 atomic commits since `c5e2d4c` (Plan Phase 02)
**Artifact under test:** `.planning/validation-runs/01-fomi-focus-app.md` (Phase 01 captured artifact — unchanged in Phase 02)
**Script:** `scripts/assert-fomi-run.ts`
**Invocation:** `npx tsx scripts/assert-fomi-run.ts`
**Exit code:** 0

## Pre-flight context

This is the **captured-artifact regression check** (T-final-2). It verifies that Phase 02 tool/validator/renderer changes did not break the assertion script's ability to read and validate the historical Phase 01 artifact — i.e., the schema, regex anchors, and assertion logic still align.

Phase 02 did NOT re-run `validate_idea` end-to-end. **T-final-3 follows with a fresh end-to-end LLM rerun** against the post-Phase-02 codebase.

## Per-assertion summary

| # | Assertion | Result | Detail |
|---|-----------|--------|--------|
| 1 | Verdict NO-GO | PASS | verdict=NO-GO |
| 2 | Killshots cite ≥2 tier S/A | PASS | 11 distinct tier-S/A URLs across 3/3 killshots |
| 3 | Gate 3 references encroachment kws | PASS | matched: "Focus mode" |
| 4 | Tool call count line present | PASS | 12 calls, ≤20 ✓ |
| 5 | Killshot count ≥ 2 | PASS | 3 killshots |
| 6 | Spiky POV blank template intact | PASS | (canonical 4-line template present) |

**Overall:** 6/6 assertions passed — Phase 01 Critical Test ✓

## Raw stdout

```
[T20] Assertion 1: Verdict NO-GO .............................. PASS (verdict=NO-GO)
[T20] Assertion 2: Killshots cite ≥2 tier S/A ................. PASS (11 distinct tier-S/A URLs across 3/3 killshots)
[T20] Assertion 3: Gate 3 references encroachment kws ......... PASS (matched: "Focus mode")
[T20] Assertion 4: Tool call count line present ............... PASS (12 calls, ≤20 ✓)
[T20] Assertion 5: Killshot count ≥ 2 ......................... PASS (3 killshots)
[T20] Assertion 6: Spiky POV blank template intact ............ PASS

[T20] OVERALL: 6/6 assertions passed — Phase 01 Critical Test ✓
```

## Interpretation

The assertion script's regex anchors, section-extraction logic, and `SPIKY_POV_BLANK_TEMPLATE_LINES` constant remain byte-compatible with the Phase 01 captured artifact. No Phase 02 refactor introduced drift between the renderer's output contract and the assertion script's parser. Pre-flight gate is green; T-final-3 is unblocked.
