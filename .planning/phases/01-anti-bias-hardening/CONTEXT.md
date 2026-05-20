# Phase 01 — Anti-Bias Hardening + Phase 2 Completion

## Phase goal

Close the 8 HIGH concerns from `.planning/codebase/CONCERNS.md` and bring the ProductValidation MCP to a verifiably-working v1 per `.planning/spec/build-spec-v1.0.md` §11 definition-of-done.

The structural problem: the spec defines 5 anti-bias mechanisms as "the core IP" (§1). Currently only 1 of 5 is enforced in code — the other 4 live as instructions to the LLM, meaning a confident model can skip them and the server won't notice. This phase converts those mechanisms from prompt-only wishes to code-enforced contracts.

## Why this matters

Spec §1 warns explicitly: *"If any of these mechanisms are skipped or watered down during implementation, the MCP loses the property that makes it valuable."* Shipping more tools (H6) into a pipeline that can still skip Contradicting Evidence or fabricate POV sections produces a *more visually impressive* watered-down product, not a better one. This phase treats the anti-bias guarantees as load-bearing rather than aspirational.

## Agreed fix order (locked with user 2026-05-20)

1. **H8 — Wayback fabrication fix** (1-2 hours)
   - `find-pricing-anchors.ts:152-159` records Wayback wildcard URLs as `tier: 'S', bias: 'independent'` sources without ever fetching them.
   - Fix: either fetch Wayback CDX API for real snapshots, or demote to `tier: 'D'` with `contribution: "search query — not a verified snapshot"`.
   - **Why first:** small fix, currently actively misleading output. Quick win.

2. **Report Validator** (~half day) — kills H1, H2, H4, H5 in one component
   - Code-side post-processing step that runs AFTER the LLM emits the markdown artifact and BEFORE return.
   - Likely structure: a new `validate_report` tool the prompt is forced to call, OR a zod schema + server-side pipe through it.
   - Must enforce:
     - **H1:** DOK 1–4 layer separation + Contradicting Evidence block per gate
     - **H2:** "Your Spiky POV" stays empty-template
     - **H4:** PASS verdicts require ≥2 tier-B-or-higher sources per gate
     - **H5:** Validation Checks decision matrix (Major → Low confidence; Fundamental → Inconclusive override)
   - **Why second:** biggest leverage point in codebase. Spec §1 mechanisms 1, 3, 4 + §11 anti-patterns 1, 3, 4, 5 all collapse into this one component.

3. **H3 — `effectiveBias()` helper** (~2 hours)
   - Spec §4 rule 4: `unknown → vendor-funded` for confidence math.
   - Spec §11 anti-pattern 6: defaulting `unknown` to `independent`.
   - Add `src/lib/bias.ts` exposing `effectiveBias(flag)` + `requiresUpgradeFromUnknown(sources)`.
   - Wire into report validator (item 2) and any tool doing confidence math.

4. **H6 — Build 4 remaining tools** (Phase 2/3 completion per spec §10)
   - **P0:** `find_why_now_signals` (Gate 5 primary) — recent enablers, regulatory shifts, YC RFS additions
   - **P0:** `estimate_demand_signals` (Gate 2 primary) — Google Trends + subreddit sizes + GitHub stars (this is where the GitHub token finally gets used)
   - **P1:** `find_public_revenue_signals` (Gate 2+4) — IndieHackers, founder MRR tweets, SEC filings, OpenStartup
   - **P1:** `assess_platform_dependency` (Gate 3) — ToS history, deplatforming retros
   - Order per spec §10: `find_why_now_signals` → `estimate_demand_signals` → `find_public_revenue_signals` → `assess_platform_dependency`.

5. **H7 — Critical Test calibration** (~1 hour, gating)
   - Spec §11: run `validate_idea` on the AI-native focus app idea, expect NO-GO with sound reasoning.
   - Calibration anchor case (Fomi) is documented in `.planning/spec/framework-context.md` §6.
   - Output: capture the validation report as `.planning/validation-runs/01-fomi-focus-app.md` regression artifact.
   - **Why last:** every other fix has to be in place for this test to be meaningful. If it returns GO after all fixes, there's still a bug.

## Out of scope for this phase

- **M1–M9 tool quality issues** — separate phase. These are tuning, not structural.
- **L1 (no tests)** — covered by H7 as end-to-end calibration; unit testing is a follow-up phase.
- **L2 (stale branches)** — housekeeping, do anytime.
- **L3 (Cursor/Claude Code smoke test)** — pre-v1 distribution check, separate phase.
- **§12 spec open product questions** — post-v1.

## Success criteria

This phase is done when:

- [ ] H8 Wayback fabrication eliminated — no tool returns S-tier sources for URLs it didn't fetch
- [ ] Report Validator exists in code and is invoked before the master prompt returns the artifact
- [ ] Report Validator rejects (or downgrades) outputs missing: DOK 1-4 separation, Contradicting Evidence block, blank Your Spiky POV section, ≥2 tier-B sources for any PASS
- [ ] `effectiveBias()` helper exists and is used wherever confidence math touches sources
- [ ] All 12 tools per spec §7 exist (currently 8 of 12 — 4 to build)
- [ ] `validate_idea` invoked on the AI focus app idea returns **NO-GO** with sound reasoning (spec §11 Critical Test)
- [ ] The NO-GO output is captured as `.planning/validation-runs/01-fomi-focus-app.md`
- [ ] All concerns H1-H8 in `.planning/codebase/CONCERNS.md` can be marked resolved

## Constraints

- **No D-tier source can validate anything** (spec §4 rule 3)
- **No fabricated data** (spec §11 anti-pattern 2) — already the standing rule, the H8 fix is its first real test
- **Tier and bias must be assigned at tool layer, not prompt layer** (Appendix B item 3) — the Report Validator and bias helper must not allow the LLM to override these
- **`unknown` defaults to `vendor-funded`** (spec §4 rule 4 + §11 anti-pattern 6) — non-negotiable
- **Tool call budget under 20 per `validate_idea` run** (§11 DoD) — implies caching needs to land alongside H6

## Required reading for planner

- `.planning/spec/build-spec-v1.0.md` — full spec, especially §1, §4, §7, §10, §11, Appendix B
- `.planning/spec/framework-context.md` — intellectual lineage; the Fomi case study (§6) defines the calibration test
- `.planning/codebase/CONCERNS.md` — full HIGH list with file:line refs
- `.planning/codebase/ARCHITECTURE.md` — current layered model
- `.planning/codebase/STRUCTURE.md` — implementation-completeness checklist
- `.planning/codebase/CONVENTIONS.md` — `ToolResult<T>` envelope, registration pattern
