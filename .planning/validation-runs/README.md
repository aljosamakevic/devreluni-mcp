# Validation Runs

Captured outputs from `validate_idea` invocations against canonical and historical product ideas. Each file is a real run, not a manufactured example — these are regression and calibration artifacts.

## Naming convention

`NN-<short-slug>.md` — sequential index, kebab-case slug.

Examples:
- `01-fomi-focus-app.md` — the founding-session calibration anchor (must return NO-GO; spec §11 Critical Test)
- `02-<future-case>.md` — subsequent ideas as they're evaluated

If a calibration FAILS (wrong verdict or wrong-for-the-wrong-reasons), pair the artifact with a `NN-<slug>-FAILURE.md` companion explaining the failure mode and which validator/tool was insufficient. Both files stay in the directory — failure artifacts are evidence of where the framework needs improvement.

## What lives in each artifact

Every `NN-<slug>.md` is the raw markdown returned by `finalize_validation_report`. Spec §5 8-section structure:

1. Header
2. Verdict (above-the-fold)
3. Evidence Report (DOK-layered per gate)
4. Validation Checks
5. What Would Change This (test cards)
6. Your Spiky POV (blank by design — user completes in their own copy)
7. Source Appendix
8. Methodology Notes

The artifact should paste cleanly into Notion / Linear / Slack.

## When to capture

- After every successful `validate_idea` run on a new idea
- When iterating on tool quality (M-series concerns) — re-run a known case to verify the verdict didn't regress
- When updating the prompt or validators — re-run the canonical case (currently `01-fomi-focus-app.md`) and diff outputs

## When a calibration test fails

Per spec §10 Phase 4: *"Re-run Aljosa's AI-native focus app idea through the MCP. Expected output: NO-GO with specific killshot reasons. If GO, there's a bug."*

If the canonical Fomi case (`01-fomi-focus-app.md`) returns GO or CONDITIONAL GO instead of NO-GO, the phase is not done. Document the failure in `01-fomi-focus-app-FAILURE.md` with:
- What verdict was returned
- Which gates failed to identify expected weaknesses
- Which tools returned thin or wrong signal
- Recommended fix path (which Stream / task / tool needs revisiting)

## Linked concerns

- Spec `.planning/spec/build-spec-v1.0.md` §10 Phase 4 + §11 DoD
- Phase 01 `.planning/phases/01-anti-bias-hardening/PLAN.md` Stream E (T18–T22)
- Framework `.planning/spec/framework-context.md` §6 (Fomi case study — the anchor)
