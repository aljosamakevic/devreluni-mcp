# Phase 07 — validate_assumption — PLAN

> **Author:** GSD planner, 2026-06-15
> **Spec basis:** CONTEXT.md (this directory), `.planning/spec/build-spec-v1.0.md` §3, §4, §10
> **Approval:** Aljosa locked verdict + sources shape (no DOK 1-4 mini-report) on 2026-06-15

---

## Task breakdown

**Total:** 5 atomic commits. Each task = one commit. Build green + 259 baseline tests still pass after each.

Complexity legend: **S** = trivial (1 file, ≤30 min). **M** = single concern (1-2 files, 30-90 min).

### T01 — Author `src/prompts/validate-assumption.ts`

- **Goal:** New file exporting `registerValidateAssumptionPrompt(server: McpServer): void`. Registers the `validate_assumption` prompt with:
  - Name: `validate_assumption`
  - Title: `"Validate a single assumption"`
  - Description: `"Verify ONE specific factual claim with tier-graded sources and forced contradicting evidence. Faster than validate_idea; same anti-bias rigor at claim granularity."`
  - Args schema (zod): `{ claim: z.string().min(1).describe('The specific factual claim to verify'), evidence_type: z.enum(['competitor_metric','pricing','demand','platform','why_now','failure_mode']).optional().describe('Routing hint for which tool subset to invoke') }`
  - Handler returns a prompt message with the body text from decision 7 in CONTEXT.md, with `${claim}` and `${evidence_type ?? '(auto-route)'}` interpolated.

- **Body content rules (encoded in the prompt text the LLM receives):**
  1. State the assumption being tested verbatim at the top.
  2. State the routing: "Evidence type: <evidence_type>. Call only the tools in that routing group. If auto-route, choose the routing group based on the claim's surface shape, then commit to it."
  3. Mandate the three anti-bias mechanics in the order: tier-grade every fact, bias-flag every source, search for contradicting evidence BEFORE forming the verdict (not after).
  4. Render the verdict output template from CONTEXT.md decision 7 VERBATIM as the expected output shape. The LLM must use this template exactly.
  5. Veto note instructions: include EXACTLY ONE of three sentences depending on whether the assumption is load-bearing, irrelevant, or recommends running full `validate_idea`.

- **Files:**
  - `src/prompts/validate-assumption.ts` (new, ~150-180 lines)

- **Acceptance:**
  - File exists; `npm run build` succeeds (TypeScript compiles).
  - `grep -F "tier-grade" src/prompts/validate-assumption.ts` returns ≥1 match (locks the tier-grading instruction is present).
  - `grep -F "contradicting evidence" src/prompts/validate-assumption.ts` returns ≥1 match (locks the contradicting-evidence search is mandated).
  - `grep -nF "Assumption verdict" src/prompts/validate-assumption.ts` returns ≥1 match (locks the verdict template heading is present in the body).

- **Dependencies:** none (new file)
- **Complexity:** M

### T02 — Register prompt in factory

- **Goal:** Add `registerValidateAssumptionPrompt(server)` call to the existing factory at `src/server/factory.ts` (per current code state). Maintain insertion order convention: after the 5 existing prompts. Stderr boot log line that lists prompts (in `src/index.ts`) updated to include `validate_assumption`.

- **Files:**
  - `src/server/factory.ts` (extend, ~3 lines)
  - `src/index.ts` (extend the stderr Prompts boot log line, ~1 line)

- **Acceptance:**
  - `grep -F "registerValidateAssumptionPrompt" src/server/factory.ts` returns ≥1 match.
  - `npm run build` succeeds.
  - Boot the server with `MCP_TRANSPORT=stdio node build/index.js`, send `prompts/list` via JSON-RPC, confirm `validate_assumption` appears with the correct arg schema. (Captured in commit message as evidence.)

- **Dependencies:** T01
- **Complexity:** S

### T03 — Tests: prompt registration + body rendering

- **Goal:** New file `src/prompts/validate-assumption.test.ts` with vitest cases:
  1. Registration: build an in-process MCP server, register all prompts via the factory, list prompts, expect `validate_assumption` in the list with the correct arg schema (claim required, evidence_type optional enum).
  2. Body rendering — auto-route: `prompts/get` with `{claim: "Cold Turkey has 80k paying users"}`, expect the returned text to contain the claim verbatim, the literal phrase "auto-route", the verdict template heading, the tier-grading instruction, and the contradicting-evidence mandate.
  3. Body rendering — typed: `prompts/get` with `{claim: "Forest prices at $1.99/mo", evidence_type: "pricing"}`, expect the returned text to contain the claim verbatim AND the literal phrase "Routing: pricing" (or however the prompt body labels the typed routing).
  4. Body rendering — invalid evidence_type: `prompts/get` with `{claim: "X", evidence_type: "garbage"}` should fail validation (zod rejects).

- **Files:**
  - `src/prompts/validate-assumption.test.ts` (new, ~80-120 lines)

- **Acceptance:**
  - `npm test` exits 0; new test count is ≥4 assertions.
  - All existing 259 tests still pass.

- **Dependencies:** T01, T02
- **Complexity:** M

### T04 — Prompt-count assertion (regression lock)

- **Goal:** Add a small assertion that the MCP server exposes exactly 6 prompts (validate_idea, steelman_against, run_single_gate, generate_test_cards, quick_kill_check, validate_assumption). This locks the count so a future refactor that accidentally drops a prompt fails loudly. Either:
  - Add a new test file `src/server/prompt-count.test.ts` that lists prompts and asserts exact set, OR
  - Extend an existing server-level test (e.g., `src/http/server.test.ts`) with a prompt-count check.

  Pick the first option — separate file makes the intent (regression lock) clearer.

- **Files:**
  - `src/server/prompt-count.test.ts` (new, ~50 lines)

- **Acceptance:**
  - Asserts exactly 6 prompts registered.
  - Asserts the literal name set `['validate_idea', 'steelman_against', 'run_single_gate', 'generate_test_cards', 'quick_kill_check', 'validate_assumption']` matches the live `prompts/list` output (order-insensitive set comparison).
  - Build green; all tests pass.

- **Dependencies:** T01, T02
- **Complexity:** S

### T05 — Smoke + final regression verification (empty commit)

- **Goal:** No code changes. Verification gate:
  1. Run `npm run smoke:http` — must exit 0 with "13 of 13 tools listed via HTTP" (tool count unchanged).
  2. Run `npx tsx scripts/assert-fomi-run.ts` — must exit 0 with 6/6 PASS (Phase 01 inviolate).
  3. Verify the full test suite count grew from 259 to ≥263 (T03 adds ~3-4 assertions, T04 adds ~2-3 assertions).

  Empty commit (`git commit --allow-empty`) records the verification in the commit message body.

- **Files:** none.

- **Acceptance:**
  - Smoke + assert-fomi-run both green.
  - Commit message body contains the verbatim output of both runs.

- **Dependencies:** T01, T02, T03, T04
- **Complexity:** S

---

## Dependency graph

```
T01 (new file) ──▶ T02 (register) ──▶ T03 (tests)
                                  ├──▶ T04 (count lock)
                                  └──▶ T05 (verification)
```

Critical path: T01 → T02 → T03 → T05 (4 sequential steps).
T04 can run in parallel with T03 (independent files), but the executor will serialize for simplicity.

---

## Risks & mitigations

### R1: Prompt routing is LLM-side; the prompt body is the only thing we control
**Concern:** The actual "routing" (picking which tools to call) happens in the LLM's reasoning, not in our code. If the prompt body is sloppy about routing instructions, the LLM may call irrelevant tools or skip the contradicting-evidence search.

**Mitigation:**
- Prompt body is explicit and imperative ("Call ONLY the tools in the routing group. Do not call tools outside it.").
- Test T03 asserts the body contains the routing instructions literally; future edits that weaken the routing language fail the test.
- The contradicting-evidence instruction is grep-locked in T01 acceptance — can't accidentally drop it.

### R2: Framework drift (carried from CONTEXT.md)
**Concern:** If users invoke `validate_assumption` 10x more than `validate_idea`, Veto's identity drifts from "idea killer" to "research helper."

**Mitigation:**
- The "Veto note" section in the verdict template steers users back: "Recommend running full `validate_idea` if this assumption holds."
- Phase 06 landing tools section will position this prompt as a drill-down companion, not standalone.
- Usage will be observable via `usage_log` (prompt invocations are LLM-side, but tool calls are server-side; the tool-call pattern will reveal whether users are doing single-claim drill-downs or multi-call sweeps).

### R3: Existing finalize_validation_report shape doesn't fit
**Concern:** If a future iteration wants a "mini-report" finalize variant, we'd be tempted to modify `src/tools/finalize-validation-report.ts` — which is Phase 01 inviolate.

**Mitigation:**
- This phase explicitly avoids touching finalize. The prompt renders its output template inline (decision 5 in CONTEXT.md).
- If a future phase wants a finalize variant, it MUST create a NEW finalize tool (e.g., `finalize_assumption_report`), not modify the existing one.
- Documented in CONTEXT.md decision 5.

---

## Out of Scope (restated from CONTEXT.md)

- Multi-claim batch validation (`validate_assumptions([...])`) — Phase 07.1 candidate.
- Caching of `validate_assumption` outputs — underlying tools already cache.
- Landing-page documentation — Phase 06 handles via auto-extraction.
- A new finalize variant — would touch Phase 01 inviolate; deferred.

---

## Definition of Done

- [ ] `src/prompts/validate-assumption.ts` exists and exports `registerValidateAssumptionPrompt`. → **T01**
- [ ] Prompt registered in factory; boot log lists 6 prompts. → **T02**
- [ ] `validate_assumption` appears in `prompts/list` with correct schema. → **T03**
- [ ] `prompts/get` returns body with claim interpolated, routing instructions, verdict template, anti-bias mandates. → **T03**
- [ ] Prompt count assertion locks the set at exactly 6 prompts. → **T04**
- [ ] All existing tests pass (259+ growing). → **T03**, **T04**
- [ ] `npm run smoke:http` exits 0 with "13 of 13 tools" (tool count unchanged). → **T05**
- [ ] `npx tsx scripts/assert-fomi-run.ts` exits 0 with 6/6 PASS (Phase 01 inviolate). → **T05**
- [ ] No modifications to `src/validation/`, `src/lib/bias.ts`, `src/prompts/validate-idea.ts`, `src/tools/finalize-validation-report.ts`. → **all tasks**

---

*Phase 07 plan. 5 atomic commits. Critical path 4 steps. Ready for `/gsd-execute-phase`.*
