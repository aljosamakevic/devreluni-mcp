# Phase 07 — validate_assumption prompt

## Phase goal

Add a sixth user-invoked prompt to the Veto MCP: `validate_assumption(claim, evidence_type?)`. It focuses Veto's anti-bias rigor on verifying ONE specific claim, rather than running the full 5-gate sweep. Two user workflows it unlocks: drill-down on a surprising claim inside an existing `validate_idea` report, and pre-flight on a single load-bearing assumption before committing to a full validation.

## Why this matters

Veto's current 5 prompts (`validate_idea`, `steelman_against`, `run_single_gate`, `generate_test_cards`, `quick_kill_check`) all operate at "idea" granularity. None of them let a user verify a single specific factual claim with the same anti-bias property (tier-graded sources, contradicting evidence forced, bias flags). Users have to either re-run the whole framework or fall back to ad-hoc search — both lose the rigor that's Veto's only differentiation.

`validate_assumption` plugs that gap with the smallest possible new surface. It reuses every existing tool. It introduces no new external dependencies. It keeps the anti-bias property intact at the claim level.

## Locked design decisions

1. **Output shape: verdict + sources only.** Aljosa locked this on 2026-06-15. NOT a full DOK 1→4 mini-report. The output is a focused verdict block (SUPPORTED / REFUTED / INCONCLUSIVE), a confidence level, the tiered evidence pile that justifies the verdict, and contradicting-evidence audit. DOK layering is the value-add of `validate_idea`'s multi-gate sweep, not of a single-claim check. Keeping it lean avoids framework drift.

2. **Prompt signature:** `validate_assumption(claim: string, evidence_type?: string)`.
   - `claim` (required): the specific factual claim to verify, free-text. Example: `"Cold Turkey has 80k paying users"`.
   - `evidence_type` (optional): hint for which tool subset to route to. Enum values: `competitor_metric` | `pricing` | `demand` | `platform` | `why_now` | `failure_mode`. When provided, the LLM skips the routing step. When omitted, the LLM picks based on the claim's surface shape.

3. **Routing logic (LLM-driven, encoded in prompt body):**
   - `competitor_metric` → `find_closest_competitor` + `read_competitor_changelog` + `find_public_revenue_signals`
   - `pricing` → `find_pricing_anchors`
   - `demand` → `estimate_demand_signals` + `scan_producthunt_launches` + `find_yc_rfs_alignment`
   - `platform` → `check_big_tech_encroachment` + `assess_platform_dependency`
   - `why_now` → `find_why_now_signals`
   - `failure_mode` → `get_category_failure_modes`
   - Multi-category claims (e.g., "Forest has 1M+ users AND prices at $1.99/mo"): LLM is allowed to call tools from multiple categories. No hard cap.

4. **Anti-bias property preserved.** The prompt body explicitly mandates:
   - Every fact tier-graded (S/A/B/C/D using the existing `source-tier-bias` resource)
   - Every source bias-flagged (independent / vendor-funded / conflicted / unknown)
   - Contradicting-evidence search before any verdict (mandatory step, NOT optional)
   - Verdict + confidence rendered explicitly with reasoning

5. **No new finalize variant.** Reuse the existing `finalize_validation_report` tool? **NO** — the existing finalize expects a full `ValidationReport` shape (5 gates, killshots, Spiky POV section, etc.) that doesn't fit the single-claim output. Instead: the prompt body specifies a markdown output template directly. The LLM renders the verdict block inline as part of its response, no separate finalize tool call needed. This keeps Phase 01's `finalize_validation_report` inviolate (it's a Phase 01 file we MUST NOT touch).

6. **Prompt count semantics.** Goes from 5 → 6. Tool count STAYS AT 13. The smoke test (`scripts/smoke-http.ts`) checks tool count, not prompt count — it remains untouched. The Phase 01 `assert-fomi-run.ts` regression script is artifact-based and not affected by prompt count changes.

7. **Verdict rendering — output template (literal, prompt encodes this verbatim):**

```markdown
# Assumption verdict

**Claim:** "<the user's claim, verbatim>"
**Verdict:** SUPPORTED | REFUTED | INCONCLUSIVE
**Confidence:** HIGH | MEDIUM | LOW
**Routed via:** <evidence_type used>

## Supporting evidence

| Source | Tier | Bias | Excerpt |
|---|---|---|---|
| <url or citation> | S/A/B/C/D | independent/vendor-funded/conflicted/unknown | <quoted fact> |
| ... | ... | ... | ... |

## Contradicting evidence (mandatory search)

| Source | Tier | Bias | Excerpt |
|---|---|---|---|
| <url or citation> | S/A/B/C/D | independent/vendor-funded/conflicted/unknown | <quoted fact> |
| ... | ... | ... | ... |

(If no contradicting evidence found after explicit search: state that directly. Empty contradicting-evidence section is acceptable ONLY if the prompt narrates "searched for X, Y, Z contradictions, none surfaced.")

## Reasoning

<2-4 sentences explaining how the evidence pile justifies the verdict + confidence. Names the tier mix. If verdict is INCONCLUSIVE, explicitly states what evidence is missing.>

## Veto note

<1 sentence. Either: "This claim, if true, is load-bearing for [gate]." OR: "This claim doesn't materially change a `validate_idea` verdict." OR: "Recommend running full `validate_idea` if this assumption holds.">
```

8. **Risk to watch (carried from chip):** framework drift. If users invoke `validate_assumption` 10x more than `validate_idea`, Veto's identity drifts from "idea killer" to "research helper." Mitigation: the prompt's own "Veto note" section steers users back toward the full validation when relevant. Also: position the prompt in user-facing docs (Phase 06 landing tools section) as a drill-down companion, not a standalone tool.

## Scope — what ships in Phase 07

### Stream A — New prompt file
- A1: `src/prompts/validate-assumption.ts` (new, ~150-200 lines, mirrors structure of `src/prompts/validate-idea.ts` but is prompts/ category, not tools/). Exports `registerValidateAssumptionPrompt(server: McpServer): void`.
- A2: Register the new prompt in the factory at `src/server/factory.ts` (or `src/index.ts` depending on current code state). Maintains alphabetical or insertion-order convention used by the other 5.

### Stream B — Tests
- B1: `src/prompts/validate-assumption.test.ts` — registration test (prompt appears in `prompts/list` with correct name + arg schema), body rendering test (calls `prompts/get` and verifies the template content includes the user's claim + the evidence_type routing instructions).
- B2: Existing smoke test (`scripts/smoke-http.ts`) — verify it does NOT depend on prompt count (current EXPECTED_TOOLS list is tools-only). No changes expected; commit message documents the verification.
- B3: An optional sanity assertion somewhere (probably a small server-test addition) that prompt count is 6 after Phase 07. Locks the count for future regressions.

### Stream C — Docs
- C1: Update `.planning/codebase/CONCERNS.md` — no new concerns (this is additive, no risk to Phase 01 inviolate property). Verify by re-running `assert-fomi-run.ts` after the new prompt registers.

## Out of scope (deferred)

- A new `finalize_validation_report` variant (rejected per decision 5 — keeps Phase 01 file untouched).
- Caching of validate_assumption outputs (the underlying tools already cache where appropriate; this prompt is read-through).
- Multi-claim batch validation (`validate_assumptions([claim1, claim2, claim3])`) — could be a Phase 07.1 extension but adds rendering complexity; not in v1.
- Landing-page documentation of the new prompt (handled by Phase 06's tools section, which auto-extracts from code).

## Success criteria

- [ ] `prompts/list` over HTTPS includes `validate_assumption` with correct arg schema
- [ ] `prompts/get` for `validate_assumption` with `{claim: "Cold Turkey has 80k paying users"}` returns the template body with the claim interpolated
- [ ] `prompts/get` for `validate_assumption` with `{claim: "…", evidence_type: "demand"}` returns the body with the demand-routing instructions in scope
- [ ] Prompt body contains literal instructions for tier-grading, bias-flagging, AND contradicting-evidence search (all three are mandatory anti-bias mechanics)
- [ ] Prompt body contains the verdict template verbatim (decision 7)
- [ ] All 259 existing tests still pass; new tests grow the count
- [ ] `scripts/smoke-http.ts` exits 0 ("13 of 13 tools listed via HTTP") — tool count unchanged
- [ ] `npx tsx scripts/assert-fomi-run.ts` exits 0 with 6/6 PASS — Phase 01 inviolate
- [ ] Prompt count assertion (new) confirms 6 prompts registered

## Constraints

- **Phase 01 inviolate files (DO NOT TOUCH):** `src/validation/`, `src/lib/bias.ts`, `src/prompts/validate-idea.ts`, `src/tools/finalize-validation-report.ts`. The new prompt lives at `src/prompts/validate-assumption.ts` (NEW file in the prompts/ directory — adjacent to but not modifying `validate-idea.ts`).
- **No modifications to existing tools.** Reuses the existing 13 tools as-is. The routing happens at the LLM level via the prompt body, not via wrapper code.
- **No new external dependencies.** Pure prompt-level addition.
- **Same atomic commit cadence** as Phase 04 / 05a.
- **Build green after every commit.**
- **Stream G assertion (`assert-fomi-run.ts`) MUST exit 0 after every commit.**

## Required reading for executor

- `.planning/spec/build-spec-v1.0.md` — §3 (5 gates), §4 (tier + bias system), §10 (Phase 4 Critical Test, anti-bias property)
- `.planning/codebase/CONCERNS.md` — for context on what's anti-bias-load-bearing
- `src/prompts/validate-idea.ts` — pattern reference (mirror structure, NOT functionality)
- `src/prompts/run-single-gate.ts` — closest existing analog (single-dimension prompt)
- `src/prompts/generate-test-cards.ts` — for the "hypothesis" vocabulary the user will recognize
- `src/server/factory.ts` (or `src/index.ts`) — registration site
- `src/resources/source-tier-bias.md` — the tier+bias system reference the prompt body cites
