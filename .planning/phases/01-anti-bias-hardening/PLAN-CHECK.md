# PLAN-CHECK — Phase 01 Anti-Bias Hardening

**Checker:** gsd-plan-checker (adversarial review)
**Date:** 2026-05-20
**Verdict:** **PASS-WITH-CAVEATS**

The plan is structurally sound: every HIGH concern (H1–H8) has at least one task closing it; the locked fix order is respected; the architectural choice (structured-JSON intermediate + zod + server-side render) is the *correct* read of spec §1 and is the only choice that closes H1/H2/H4/H5 without leaving an LLM-skippable surface; risks are real and mitigations are concrete. However, three substantive caveats need addressing before execution — the most important being that **T09 still leaves a "validation-can-be-routed-around" seam** the planner has not fully closed (see Q3), and **T20's assertion 2 ("killshots cite tier-S/A sources") is not directly enforced in code — it is a manual checklist**, which is exactly the watered-down failure mode this phase exists to prevent (see Q7).

---

## Q1 — Coverage: every H1–H8 mapped to task IDs

**YES** — full coverage.

| H# | Concern | Covered by | Notes |
|----|---------|-----------|-------|
| H1 | DOK 1-4 layering + Contradicting Evidence enforcement | **T07** (rules 1–5) | DOK 1–4 each get a dedicated rule; CE has rule 5 with explicit sentinel. |
| H2 | Spiky POV blank-template guarantee | **T07** rule 6 + **T09** renderer always emits from constant (defense-in-depth) | Byte-for-byte match enforced. |
| H3 | `unknown → vendor-funded` helper | **T03** (helper) + **T04** (wire-in) | T08 also consumes it. |
| H4 | PASS requires ≥2 tier-B-or-higher sources | **T08** rule 1 | Mechanical downgrade. |
| H5 | Validation Checks decision matrix | **T08** rule 4 | Major→Low, Fundamental→Inconclusive override. |
| H6 | Build 4 missing tools | **T10, T12, T14, T16** | Spec §10 order respected (see Q2). |
| H7 | Critical Test (Fomi case NO-GO) | **T18, T19, T20** | See Q7 — assertion structure is partly manual. |
| H8 | Wayback fabrication | **T01, T02** | T01 builds CDX client; T02 deletes the wildcard. |

No H-number unmapped. **PASS.**

---

## Q2 — Locked order respected (H8 → Validator → H3 → H6 → H7)

**YES, with one nuance.**

The dependency graph (lines 366–390) serializes correctly **across the gating constraints**, but parallelism inside streams is fine and intentional:

- **H8 (T01→T02)** — Stream A, no upstream deps. Can start day-one.
- **Report Validator (T05→T06→T07→T08→T09)** — Stream B. T08 explicitly depends on T03 (H3), so H3-before-H4/H5-finalization is respected.
- **H3 (T03)** — Stream C, no upstream deps; T04 wires it. T08 depends on T03, so it lands before validator finalization — correct.
- **H6 (T10→T12→T14→T16)** — Stream D is **explicitly sequential** (line 400-401: "Anti-parallelism… The four Stream D tools must build in order"). Matches CONTEXT.md fix-order step 4 + spec §10.
- **H7 (T18→T19→T20)** — Stream E gating: T18 depends on `{T02, T09, T17}` (line 305 + 388), i.e. all prior streams must ship. Correct.

The order CONTEXT.md locked was "first H8, then Validator, then H3, then H6, then H7." In the plan H3 (T03) is allowed to run in parallel with the Validator types (T05/T06) — this is **fine** because T03 has no dependency on validator types and T08 (the validator step that *consumes* `effectiveBias`) explicitly waits for T03. The user said "fix order," not "absolute serialization" — the constraint is "H3 must land before validator finalization," which the graph enforces.

**PASS.**

---

## Q3 — Code-side enforcement, not prompt-only

**MOSTLY YES — one residual seam needs hardening.**

The chosen architecture (Stream B's structured-JSON-then-render) is the correct call. The planner's defense at lines 81–88 is precisely right: "A tool the LLM can skip is exactly the watered-down failure mode." Per anti-bias mechanism:

| Mechanism (spec §1) | Enforcement | Can LLM route around? |
|--------------------|-------------|-----------------------|
| DOK 1→4 separation | T07 rule 1–4 over parsed JSON | **No** — schema requires the fields; validator rejects empty layers. |
| Contradicting Evidence required | T07 rule 5 | **No** — either entries OR the literal sentinel string. |
| Blank Spiky POV | T07 rule 6 + T09 renderer overrides | **No** — even if LLM populates `spiky_pov`, T07 rejects AND renderer ignores it. Defense-in-depth confirmed. |
| ≥2 tier-B sources for PASS | T08 rule 1 | **No** — mechanical downgrade. |
| Validation Checks override | T08 rule 4 | **No** — mechanical, runs in code. |
| Tier+bias at tool layer | Existing convention + T04 audit | **No** for the 4 new tools (T10/T12/T14/T16 each must use `effectiveBias`). |

**However — the residual seam (T09):** The plan instructs the model in `validate-idea.ts` Step 7 to "emit JSON and the server will validate." But what if the model **doesn't** emit JSON, or emits markdown directly? Spec §1: "if any mechanism is **skipped**…" — the LLM choosing to emit markdown instead of JSON is a skip path. T09's acceptance criteria do not cover the case where the LLM emits raw markdown bypassing `finalize_validation_report` entirely. The prompt *instructs* JSON, but the prompt-only instruction is what we said does not work.

**CAVEAT (must fix in T09 before execution):**
Add an explicit acceptance criterion: "If `finalize_validation_report` is not called for a given `validate_idea` invocation, the prompt's final instruction is a hard refusal to render — there is no markdown-only escape hatch." Practically: the `validate_idea` prompt's last sentence must say "Do not output any markdown; output only a single JSON code block to be passed to `finalize_validation_report`." Add an acceptance line: "Inspecting `src/prompts/validate-idea.ts` shows the final step instructs JSON-only output; no example markdown report appears after Step 7."

Without this, the architecture is sound but the prompt-level wiring still permits a confident model to emit markdown directly and skip the validator. **Severity: blocker** — directly contradicts the spec §1 anti-watering-down guarantee that motivates this phase.

---

## Q4 — Spec citation density

**YES** — every implementation task cites spec sections.

Spot-check:
- T01: §4, §7, Appendix B(3). ✓
- T02: §11 anti-pattern 2, §11 sound-reasoning. ✓
- T03: §4 rules 1–4, §11 anti-pattern 6. ✓
- T05–T09: §1 mechanisms, §3, §4, §5, §6.1, Appendix B(3)(5), §11 anti-patterns 1,3,4,5. ✓
- T10/T12/T14/T16: §7 line refs, §10 build order, Appendix B(3). ✓
- T18–T20: §10 Phase 4, §11 DoD, `framework-context.md` §6. ✓

Two planning-hygiene tasks (**T21, T22**) explicitly state "spec refs: none (planning hygiene)" — that is correct labeling, not missing citation.

**PASS.**

---

## Q5 — Acceptance criteria are objective

**MOSTLY YES, two soft spots.**

Most acceptance lines are testable from the outside:
- Grep checks (T02, T04). ✓
- File-existence + structural assertions (T07, T08, T18, T19). ✓
- Byte-match against `SPIKY_POV_BLANK_TEMPLATE` (T07, T09). ✓
- Numeric thresholds (T08 rule 1: <2 → downgrade). ✓

**Two soft spots:**

1. **T09 acceptance "Round-trip: render a synthetic valid report → markdown → eyeball matches spec §5 section headings."** "Eyeball" is not objective. Replace with: "Render a synthetic valid report; assert the output contains all 8 section headings from spec §5 (`Idea:`, `Verdict`, `Gate 1:` through `Gate 5:`, `Validation Checks`, `What Would Change This`, `Your Spiky POV`, `Source Appendix`, `Methodology Notes`) in that order." Severity: warning.

2. **T19 acceptance "Tool call budget ≤20 per §11 DoD (count visible in Methodology Notes)."** This is testable, but T19 says "Manually (or via a scripted MCP client) invoke" — the manual path means a human eyeballs the count. Spec §11 makes this a DoD item. Recommend: T19 emits the tool-call count as a structured line in the methodology notes section so T20 can grep for it (`Tool calls fired: N`) rather than counting visually. Severity: warning.

---

## Q6 — `unknown → vendor-funded` enforced in code and wired everywhere

**YES.**

- Helper exists in T03 (`effectiveBias`).
- Wired into validator math: T08 explicitly depends on T03 and uses `effectiveBias()` for the conflicted-ratio calculation (line 133).
- Wired into the 4 new tools: T10/T12/T14/T16 each list T03 as a dependency and acceptance criteria mention "uses `effectiveBias()` anywhere it reasons about source mix."
- T04 audits existing tools.

Grep acceptance in T04 (`grep -rn "bias.*unknown" src/tools/` — no tool reasoning about `unknown` outside `effectiveBias`) is the right external check.

**One small risk worth flagging (not a blocker):** T04's acceptance line "Existing tool outputs unchanged for sources that were already `independent`/`vendor-funded`/`conflicted`" presumes none of the existing 8 tools currently emit `unknown`. The plan should call out an explicit audit step: "Before changing any code, grep existing tools for `bias: 'unknown'` to confirm scope of behavior change." If even one existing tool emits `unknown` today, T04 *is* a behavior change and the acceptance line is wrong. Severity: warning.

---

## Q7 — H7 calibration robustness (catches "right answer for wrong reasons")

**PARTIALLY YES — the structure is there, the enforcement is manual.**

T20 has three assertions (line 326–328), which is the right framework:
1. Verdict NO-GO.
2. ≥2 killshots cite tier-S or tier-A sources.
3. Killshots align with framework-context.md §6 case (cloud-screenshot privacy, Apple Intelligence/Screen Time, <$10/mo WTP, ADHD churn).

This is genuinely the right structure for H7. **But:**

- Assertion 2 ("cite tier-S or tier-A sources") is **trivially mechanically verifiable** because every DOK 1 fact already carries a tier badge (per T05 schema). The plan should explicitly state: "Parse the rendered markdown's Source Appendix; for each killshot reason's cited source URL, look up its tier; assert ≥2 cited sources have tier ∈ {S, A}." Without this, "killshots cite tier-S/A" is a human reading the report.
- Assertion 3 (alignment with the four substantive concerns) is **inherently qualitative** — there's no string-match for "Apple Intelligence" that proves the report identified Apple Intelligence as a Gate 3 killer; "Apple's AI" or "Apple's system features" could be the same finding worded differently. T20 leaves this as a checklist call. That is *appropriate* — fully automating it would be brittle — but the plan should be honest that assertion 3 is human-judged.

**CAVEAT (should fix in T20):** Promote assertion 2 from human-checklist to mechanical assertion. Add to T20 acceptance: "Assertion 2 is verified by parsing the artifact's Source Appendix and the killshot citations (the verdict block); a simple script asserts ≥2 distinct sources cited in the killshot reasons have tier ∈ {S, A} in the appendix." Severity: warning (not blocker because the assertion *exists*, it's just under-mechanized).

**Additional gap not in the plan:** T20 does not explicitly assert that **Gate 3's DOK 1 facts include at least one source about Apple's Screen Time API, Apple Intelligence, or Focus Modes.** CONCERNS.md M5 (out of scope here) already flagged that `check_big_tech_encroachment` may miss these. If T20 doesn't catch the absence, the report can be NO-GO for unrelated reasons (e.g., competitor saturation) and the Gate-3-blindness ships. Severity: warning — worth adding as a *substantive* assertion in T20 even if M5 is out of scope, because the plan claims H6 + Validator together close H7.

---

## Q8 — Risk register completeness

**MOSTLY YES — one significant missing risk.**

Plan flags 5 risks (lines 406–448). The planner mentions 3 "open questions" in CONTEXT.md framing terms but the plan itself articulates 5 risks. They are:

1. JSON-then-render breaks Notion-pasteability — *real, mitigated by deterministic renderer*. Adequate.
2. `estimate_demand_signals` complexity / scope creep — *real, mitigated by locked MVP scope*. Adequate.
3. H7 "right answer wrong reasons" — *real, mitigated by T20's three assertions*. See Q7 caveat above.
4. Wayback CDX rate limits — *real but low-probability*. Adequate.
5. Tool budget overrun — *adequately bounded; 13 estimated vs 20 ceiling*. Adequate.

**Missing risk — the prompt question I was asked to consider:** *"What if Stream B's structured-JSON refactor breaks existing prompt invocations from Claude Desktop?"*

This is real and not in the plan. Specifically:
- `validate_idea` is invoked by users in Claude Desktop today (presumably emitting markdown).
- After T09 ships, the prompt now emits JSON and *requires* a follow-up call to `finalize_validation_report`. If Claude Desktop's MCP client interaction model handles this fine, no problem. If a user has cached/copied earlier validate_idea invocations or examples in their workflow, the upgrade is breaking.
- The same prompt name (`validate_idea`) now has different observable behavior pre/post-phase-01.

**CAVEAT (should add):** Add Risk 6 — "Existing prompt invocations are observationally different after T09." Mitigation: (a) T19 *is* effectively the integration test in Claude Desktop, so this is caught; (b) consider bumping the MCP server semver and noting the breaking change in `validate_idea` description text. Severity: warning.

**Also missing — not asked but worth flagging:** The plan assumes the model will reliably emit valid JSON conforming to the zod schema. If it doesn't (schema parse fails), T09's described behavior is "tool returns ok:false + the prompt re-tries." But that re-try is itself a tool call against the 20-call budget (Risk 5). If the model loops on schema failures, budget exhaustion could be a real failure mode. Mitigation isn't hard (cap retries at 2), but it's not in the plan. Severity: info.

---

## Q9 — Out-of-scope discipline (no M-level / L-level creep)

**MOSTLY YES, with two explicit "bonus" admissions that are acceptable.**

Lines 454–458 cleanly restate out-of-scope:
- M1–M9 deferred. ✓
- L1 (tests) — H7 is the integration test, no unit tests added. ✓
- L2/L3 — not touched. ✓
- §12 spec open questions — not touched. ✓

**Acknowledged "bonus" overlap (acceptable):**
- T02 fixes part of M3 by coincidence (Wayback URL no longer cited unfetched). The plan calls this out explicitly. Acceptable — it's the same code, you can't fix H8 without touching M3's surface.
- T12 addresses M7's subscriber-count gap. The plan calls this out explicitly. Acceptable — building `estimate_demand_signals` per spec §7 (which lists subscriber counts as Tier A) *requires* solving the Reddit-via-Serper limitation that M7 documents. You can't ship the tool to spec without doing this.

**One potential creep — T22 (CONVENTIONS.md + ARCHITECTURE.md updates):** This is documentation hygiene. CONTEXT.md does not require docs updates; CONCERNS.md does not list this. It's good practice but it's a planner-added task. Severity: info (not blocker — docs drift is real if not updated, but it's scope expansion the planner should have asked about).

**One actual creep — T11/T13/T15/T17 (tool-to-gate-map updates):** These four tasks update `src/resources/tool-to-gate-map.md` which CONCERNS.md doesn't list. However, spec §7's tool-to-gate map *is* the resource the prompt reads, so a new tool without a map update is a broken integration. These are correctly in scope — they're not creep, they're necessary completion of the H6 tool-build tasks. Could be folded into the parent tool task (T10/T12/T14/T16) rather than split out. Severity: info — see Q10.

---

## Q10 — Atomic-commit sizing (each task = one commit, L tasks split if oversized)

**MOSTLY YES — five L-complexity tasks deserve a closer look.**

Distribution: 5 S + 8 M + 9 L (line 478). Nine L-tasks is a lot. Spot-checking:

- **T08 (L)** — extends `report-validator.ts` (~150 LOC) + fixture file. Tight but plausibly one commit.
- **T09 (L)** — new renderer (~250 LOC) + new tool (~80 LOC) + prompt modify + index register. **This is genuinely four atomic concerns**: renderer, tool registration, prompt change, index wire-in. **Recommend splitting T09 into T09a (renderer + tests), T09b (tool + index registration), T09c (prompt modification).** Severity: warning — this is the highest-risk task and the planner notes Risk 1 mitigation depends on the renderer being deterministic; splitting reduces the blast radius of a renderer bug.
- **T10 (L)** — new tool (~250 LOC) + index register. One commit acceptable; matches the existing `find_pricing_anchors` pattern.
- **T12 (L)** — new `github.ts` lib (~120 LOC) + `reddit.ts` extension (~40 LOC) + new tool (~280 LOC). **This is also genuinely three atomic concerns.** Risk 2 mitigation already says "if T12 starts to exceed L complexity, split: ship v1 with only GitHub + Reddit." Recommend pre-splitting: T12a (`github.ts` client), T12b (`reddit.ts` subscriber count), T12c (the tool itself wiring them). Severity: warning.
- **T14 (L), T16 (L)** — each new tool ~250-280 LOC + index register. One commit each is acceptable, similar to T10.
- **T11/T13/T15/T17 (S each)** — each is "update tool-to-gate-map.md." Four near-identical small commits. Could each be folded into the prior tool task's commit (T11 into T10's commit, etc.). Splitting them out is fine but adds commit overhead. Severity: info.

**Net:** T09 and T12 should be split before execution. Other L-tasks are within atomic-commit tolerance for this codebase.

---

## Specific change requests (PASS-WITH-CAVEATS)

**Blockers (must address before execution):**

1. **T09 — close the markdown-emission escape hatch.** Add acceptance criterion: "`src/prompts/validate-idea.ts` Step 7's final instruction states that JSON-only output is required; no example markdown report follows Step 7; the prompt does not invite or describe direct markdown output." Update the prompt body accordingly. This is the residual seam from Q3.

**Warnings (should address before or during execution):**

2. **T09 — split into T09a/T09b/T09c** (renderer / tool+register / prompt change). One commit per atomic concern. (Q10)
3. **T12 — split into T12a/T12b/T12c** (`github.ts` / `reddit.ts` extension / tool wiring). (Q10)
4. **T09 acceptance — replace "eyeball matches spec §5"** with explicit 8-section-heading existence check. (Q5)
5. **T19 acceptance — emit tool-call count as a structured line** ("Tool calls fired: N") so T20 can mechanically grep it. (Q5)
6. **T20 assertion 2 — promote to mechanical check.** Parse Source Appendix; for each killshot reason's cited source, assert tier ∈ {S, A}. (Q7)
7. **T20 — add substantive assertion for Gate 3 coverage.** At least one Gate 3 DOK 1 fact references Apple Intelligence / Screen Time API / Focus Modes / Digital Wellbeing. Catches the H6 vs M5 boundary. (Q7)
8. **T04 — add audit step** to grep existing tools for `bias: 'unknown'` *before* changing code, so the "no behavior change" acceptance is actually true. (Q6)
9. **Risk register — add Risk 6:** existing `validate_idea` invocations are observationally different post-T09; mitigation = T19 is the integration test + bump MCP semver. (Q8)

**Info (consider, do not block):**

10. **T22 — optional.** Doc updates are good hygiene but were planner-added; not in CONTEXT.md success criteria. Acceptable scope expansion. (Q9)
11. **T09 — cap finalize-retry attempts at 2** so a schema-parse loop can't blow the 20-call budget. (Q8)
12. **T11/T13/T15/T17 — could be folded** into their parent tool tasks; current split is fine but adds 4 trivial commits. (Q10)

---

## The 3 open questions the planner flagged — my take

The planner did not explicitly enumerate "3 open questions" in PLAN.md, but the prompt asked me to take a position on them. Reading the plan carefully, the three soft spots the planner left implicit are:

### Open question 1 — "tool the prompt is forced to call OR zod schema + server-side pipe"
**Planner's choice:** Structured JSON + zod + server-side render (lines 80–88).
**My take: DECIDE NOW (planner already decided correctly).** This is the right call. The defense at lines 81–88 maps precisely to spec §1's anti-watering-down constraint. A `validate_report` tool the LLM calls post-hoc is exactly the LLM-skippable surface the spec rejects. **No re-plan needed.** *Caveat:* tighten T09 per Blocker 1 above so the markdown escape hatch is closed at the prompt level too.

### Open question 2 — "MVP scope of `estimate_demand_signals`"
**Planner's choice:** GitHub + Reddit subscriber counts + Serper-aggregated trends. Defer Google Trends API + SimilarWeb. (Risk 2.)
**My take: DEFER (planner's scope is right).** Spec §7 lists Trends as A-tier and SimilarWeb as S-tier; neither is *required* — the spec is explicit that paid APIs gracefully degrade. Locking the MVP to GitHub (S) + Reddit subscriber counts (A) + Serper aggregates (B) gives Gate 2 a working primary tool, which is what H6 needs. **No re-plan needed.** *Caveat:* split T12 per Warning 3 above.

### Open question 3 — "do we need automated tests for the validator (L1)"
**Planner's choice:** Out of scope (line 455–456); H7's calibration run is the integration test.
**My take: DEFER, BUT WITH A NOTE.** This is the right call for *this phase* — the planner correctly notes that L1 is a separate phase and H7 is the integration test that proves the validator works end-to-end. However, T07/T08 already specify **synthetic fixture-based self-tests** (line 140: `src/lib/__fixtures__/synthetic-report.ts`) as part of acceptance. That is already a partial L1 down-payment. **No re-plan needed.** Worth flagging in the post-phase write-up that the validator gained de-facto unit tests as a side effect; L1 then becomes "test the parsers" rather than "test everything."

---

## Final verdict paragraph

**PASS-WITH-CAVEATS.** The plan correctly identifies the structural problem (4 of 5 anti-bias mechanisms live in prompt text), chooses the only architecture that closes it without leaving an LLM-skippable surface (structured-JSON intermediate + zod validator + server-side markdown rendering), and serializes the work to respect the user's locked fix order. Every H-concern (H1–H8) maps to specific task IDs; the dependency graph is acyclic and reflects spec §10's sequential constraint on Stream D. The blocker is narrow but real: **T09 instructs the LLM to emit JSON but does not foreclose the markdown-emission escape hatch at the prompt level**, which is the exact "watered-down" failure mode spec §1 names — fix this by tightening `validate-idea.ts` Step 7 and adding a corresponding acceptance criterion. The remaining warnings (T09/T12 splitting, T20 assertion mechanization, T04 pre-audit, Risk 6 addition) are quality improvements, not goal-blockers. With Blocker 1 fixed, the plan will deliver phase 01's goal — the spec §11 Critical Test returning NO-GO with tier-S/A-sourced killshots — and close H1–H8 in the order the user locked.

---

## v0.2 Re-verification (2026-05-20)

**Re-checker:** gsd-plan-checker (focused re-verification — only checked what v0.2 claims to change)

### Q1 — Blocker resolved? Markdown-emission escape hatch closed?

**YES.** T09c (lines 184–198) rewrites `validate-idea.ts` Step 7 to JSON-only with multiple grep-verifiable acceptance lines:
- Step 7 final text: *"Emit your final output as a single JSON code block… Do not output any markdown report yourself"* (line 186).
- Explicit instruction to delete prior example markdown report after Step 6/7 (line 187).
- `<retry_policy>` block encodes "Maximum 2 attempts per run" (line 188).
- Failure mode = `validation_failed` error, no fabricated markdown (T09b acceptance line 180: *"Calling with `attempt: 2` and parse failure returns `error: "validation_failed"` and an empty body — no fabricated markdown under any path"*).
- Acceptance criteria are grep-based: `grep -n "^# Idea:\|^## Verdict\|^Gate 1:" src/prompts/validate-idea.ts` returns no matches (line 193); `grep -c "Do not output any markdown"` ≥1 (line 194); `grep -c "Maximum 2 attempts"` ≥1 (line 195). All mechanical, no eyeballing.

Defense-in-depth confirmed: T09a renderer (line 156) always emits `SPIKY_POV_BLANK_TEMPLATE` regardless of input, AND T09b returns empty body on validation failure, AND T09c forbids markdown in prompt. Three independent layers.

### Q2 — 6 warnings applied?

**YES on all 6.**
- **T09 split** → T09a (renderer, lines 149–166), T09b (tool + register, lines 168–182), T09c (prompt rewrite, lines 184–198). YES.
- **T12 split** → T12a (github.ts, lines 281–294), T12b (reddit getSubredditMeta, lines 296–305), T12c (tool wiring, lines 307–323). YES.
- **T09a 8-section heading check** → line 162: "assert the output contains the 8 spec §5 section headings — exact heading text — in order: `Idea:`, `Verdict`, `Gate 1:`… implemented as eight `assert(output.indexOf(heading) > prev_index)` checks". Mechanical. YES.
- **T19 emits `Tool calls fired: N`** → line 396 explicitly requires the structured line; acceptance line 403 greps it: `grep -E "^Tool calls fired: [0-9]+$"` returns exactly 1. YES.
- **T20 assertion 2 mechanical** → lines 412–417: parse Source Appendix into `url → tier` map, parse killshots, assert ≥2 cited URLs have `tier ∈ {S, A}`. Implemented in `scripts/assert-fomi-run.ts` (line 431). YES.
- **T20 Gate 3 substantive assertion** → assertion 3 (line 419): mechanical case-insensitive match for `apple intelligence | screen time api | focus mode | digital wellbeing`. YES.

### Q3 — T04 audit pre-step?

**YES.** T04-audit (lines 221–233) precedes T04: greps `bias: 'unknown'` in `src/tools/` to `.planning/phases/01-anti-bias-hardening/audit-unknown-bias.txt`, classifies each hit as `SAFE` or `BEHAVIOR-CHANGE-SITE`, and T04's acceptance line 245 cross-references the audit artifact. T04 now depends on T04-audit (line 247). The "no behavior change" claim is now verifiable against the audit file, not asserted blindly.

### Q4 — Risk 6 added?

**YES.** Risk 6 (lines 555–563) addresses the observational protocol-shape change for existing `validate_idea` callers. Mitigations: T19 as MCP-client integration smoke test; semver bump to 0.2.0 in `package.json`; updated `validate_idea` description text. T22 (line 452) documents the semver bump in CONVENTIONS.md and ARCHITECTURE.md. Severity correctly classified as warning.

### Q5 — Dependency graph updated?

**YES.** Graph (lines 461–489) shows:
- T09a → T09b → T09c chain (lines 470, 493–494).
- T12a/T12b → T12c (lines 476–478, 495).
- T18 depends on `{T02, T09c, T17}` (line 487) — correctly references T09c not the monolithic old T09.
- T04-audit inserted between T03 and T04 (line 468, 496).
- Critical path updated to "T03 → T05 → T06 → T07 → T08 → T09a → T09b → T09c → …" (line 491). All splits propagated correctly.

### Q6 — No new issues introduced (spot-check 5 random tasks)?

Spot-checked T01, T06, T09b, T12c, T16, T20:
- **T01** acceptance (lines 56–57): regex-verified URL shape, no `throws` to caller. Mechanical. ✓
- **T06** acceptance (lines 106–108): `parseValidationReport({})` returns errors; round-trip; schema rejects exact gate/check counts. Mechanical. ✓
- **T09b** acceptance (lines 177–180): tool registered in startup log; malformed JSON behavior; structural-fail behavior; `attempt: 2` failure mode. Mechanical. ✓
- **T12c** acceptance (lines 316–321): real numeric stars; graceful fallback; real subscriber counts; `effectiveBias()` use. Mechanical. ✓
- **T16** acceptance (lines 361–365): detects specific platform keywords; bias tagging; `grep -E "Apple Intelligence|Screen Time API|Focus Modes|Digital Wellbeing" src/lib/platform-keywords.ts` ≥4. Mechanical. ✓
- **T20** acceptance (lines 433–437): `scripts/assert-fomi-run.ts` exit codes; PASS-or-FAILURE doc; assertions implemented in code. Mechanical. ✓

No vibes-based language detected. Assertion 4 in T20 (line 421) is explicitly flagged "Inherently qualitative — flagged as human-judged" — honest labeling, not a regression.

### Q7 — Definition of Done still complete?

**YES.** Each CONTEXT.md success criterion maps to specific (post-split) task IDs:
- H8 Wayback → T01, T02 ✓
- Report Validator → T05, T06, T07, T08, T09a, T09b, T09c ✓
- Validator rejects/downgrades → T07 + T08 ✓
- Markdown-emission escape hatch closed (NEW DoD line 584) → T09c ✓
- `effectiveBias()` helper → T03, T04-audit, T04 ✓
- All 12 tools → T10, T12c, T14, T16 ✓
- NO-GO on focus app → T19, T20 ✓
- NO-GO captured as `.planning/validation-runs/01-fomi-focus-app.md` → T18, T19 ✓
- Gate 3 coverage (NEW DoD line 589) → T20 assertion 3 ✓
- H1–H8 markable resolved → T21 ✓
- Docs + semver bump → T22 ✓

The DoD section (lines 577–591) explicitly extends to cover Risk 6 (semver) and the new T20 assertion 3. No criterion orphaned.

---

## v0.2 Verdict

**PASS — plan is execution-ready.**

The planner addressed every blocker, warning, and the volunteered info item from v0.1. The markdown-emission escape hatch is closed at three independent layers (prompt, validator, renderer), all acceptance criteria for the previously-soft tasks are now mechanical (grep, byte-match, or scripted assertions), the T09/T12 splits give clean atomic-commit boundaries, T04-audit makes the "no behavior change" claim verifiable, and Risk 6 + semver bump acknowledges the breaking observational change. Dependency graph reflects all splits and the new T09c gating dependency for T18. Spot-checks of 6 tasks surfaced no new vibes-based language. The plan is now precisely as adversarially tight as the phase goal demands. Execution can begin.
