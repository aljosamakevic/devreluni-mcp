# Phase 01 — Anti-Bias Hardening + Phase 2 Completion

> **Author:** GSD planner, 2026-05-20 (v0.2 revision)
> **Spec basis:** `.planning/spec/build-spec-v1.0.md` v1.0
> **Concerns basis:** `.planning/codebase/CONCERNS.md` — closes H1–H8
> **Fix order:** locked with user 2026-05-20; do not reorder

---

## Phase Goal

Convert the 5 anti-bias mechanisms in spec §1 from "instructions the LLM may follow" to "contracts the server enforces," and complete the 4 remaining tools required by spec §10 so all 5 gates have a primary signal source. Phase is done when the spec §11 Critical Test — `validate_idea` against the AI-native focus app idea — returns **NO-GO** with killshot reasons that cite specific tier-S or tier-A sources.

**Tie to spec:**
- §1 ("If any of these mechanisms are skipped or watered down… the MCP loses the property that makes it valuable") — drives Streams A, B, C.
- §10 build sequence (`find_why_now_signals` → `estimate_demand_signals` → `find_public_revenue_signals` → `assess_platform_dependency`) — drives Stream D.
- §11 DoD ("validate_idea on the AI-native focus app idea returns NO-GO with sound reasoning") — drives Stream E.
- §11 anti-patterns 1, 2, 3, 4, 5, 6 — closed in code, not in prompt text.

---

## Goal-Backward Verification

Each CONTEXT.md success criterion maps to specific tasks below. If any row's tasks all pass and the criterion is still untrue, the plan has a gap.

| Success criterion (CONTEXT.md §"Success criteria") | Producing task(s) |
|---|---|
| H8 Wayback fabrication eliminated — no tool returns S-tier sources for URLs it didn't fetch | **T01, T02** (Stream A) |
| Report Validator exists in code and is invoked before the master prompt returns the artifact | **T05, T06, T08, T09a, T09b, T09c** (Stream B) |
| Report Validator rejects/downgrades outputs missing DOK 1-4 separation, Contradicting Evidence, blank Spiky POV, ≥2 tier-B sources for PASS | **T06** (schema), **T07** (DOK + CE + POV checks), **T08** (source-count + matrix checks) |
| `effectiveBias()` helper exists and is used wherever confidence math touches sources | **T03** (helper), **T04-audit** (audit), **T04** (wire into validator + existing tools) |
| All 12 tools per spec §7 exist (4 to build) | **T10, T12a/T12b/T12c, T14, T16** (Stream D — one per tool in spec §10 order) |
| `validate_idea` on the AI focus app idea returns NO-GO with sound reasoning | **T18, T19, T20** (Stream E) |
| NO-GO output captured as `.planning/validation-runs/01-fomi-focus-app.md` | **T19** |
| All concerns H1–H8 markable resolved | H1+H4 → T07+T08; H2 → T07+T09a; H3 → T03+T04; H5 → T08; H6 → T10/T12c/T14/T16; H7 → T18–T20; H8 → T01/T02 |

---

## Task Breakdown

**Total:** 28 tasks across 5 streams. Each task is sized to be a single atomic commit.

Complexity legend: **S** = ≤1h, single file edit, no new external dependency. **M** = 1–3h, multi-file or new internal module. **L** = 3–6h, new external integration, parser work, or cross-cutting wiring.

---

### Stream A — H8 Wayback Fabrication Fix

Smallest, most isolated; start here. Closes a currently-active misleading output (S-tier sources for URLs we never fetched). Spec §11 anti-pattern 2 + §11 sound-reasoning test ("a source URL that actually exists and contains the claimed information").

#### T01 — Add Wayback CDX client to `src/lib/`
- **Goal:** New `src/lib/wayback.ts` exposing `fetchWaybackSnapshots(domain, pathHint, sinceISO)` that hits `http://archive.org/wayback/available?url=…` (no auth required) and returns 0–3 actual snapshot URLs with timestamps, OR an empty array. Mirrors the Serper quartet convention (CONVENTIONS.md "Graceful Degradation"): `isWaybackLive()` (always true — no key), `waybackSource(snapshot)` returning a real `ToolSource` with `tier: 'S'`, `bias: 'independent'`, `fetched_at = snapshot timestamp`, `waybackConfidenceNote()`.
- **Files:** `src/lib/wayback.ts` (new, ~80 lines)
- **Spec refs:** §4 tier definitions ("Wayback snapshots" = S-tier); §7 graceful-degradation contract; Appendix B(3) tool-layer provenance.
- **Acceptance:**
  - `fetchWaybackSnapshots('freedom.to', '/pricing')` returns either `[]` or a list of `{ url, timestamp }` where every URL is a real `web.archive.org/web/<numeric-timestamp>/…` path (no wildcards).
  - Network failure is caught and surfaced via `confidence_note`; never throws to caller.
- **Dependencies:** none
- **Complexity:** M

#### T02 — Replace fabricated Wayback source in `find_pricing_anchors`
- **Goal:** Remove the wildcard-URL hack at `src/tools/find-pricing-anchors.ts:152-159`. Use `fetchWaybackSnapshots(domain, '/pricing')` from T01. If snapshots returned: push one `ToolSource` per real snapshot (`tier: 'S'`, `bias: 'independent'`). If empty: do NOT push a Wayback source at all — instead, append `'wayback (no snapshots found)'` to `fallbacks_used` and lower confidence per existing pattern. Under no circumstance record an S-tier source for an unfetched URL.
- **Files:** `src/tools/find-pricing-anchors.ts` (delete lines 151-159, replace with conditional block; ~25 lines net change)
- **Spec refs:** §11 anti-pattern 2; §11 sound-reasoning test.
- **Acceptance:**
  - `grep -n "web.archive.org/web/2024\*" src/tools/find-pricing-anchors.ts` returns no matches.
  - All `sources` entries with `tier: 'S'` and `web.archive.org` in the URL have a numeric timestamp (regex `/web\.archive\.org\/web\/\d{8,14}\//`).
  - If Wayback returns nothing, `fallbacks_used` contains a wayback entry and `confidence_note` mentions the gap.
- **Dependencies:** T01
- **Complexity:** S

---

### Stream B — Report Validator (kills H1 + H2 + H4 + H5)

Biggest leverage point. Builds the single component that flips four anti-bias mechanisms from prompt instructions to enforced code.

**Architectural decision — recorded here as the planner's call (per CONTEXT.md fix-order rule "Likely structure: a new `validate_report` tool the prompt is forced to call, OR a zod schema + server-side pipe through it"):**

> **Chosen approach: structured JSON intermediate + zod validator + server-side markdown rendering. The master prompt is restructured to emit a typed JSON object representing the full report; a `ValidationReport` zod schema parses it; the validator runs decision rules over the parsed object; the server renders the final markdown.**

**Why this over an LLM-called `validate_report` tool:**
1. **Cannot be routed around.** A `validate_report` tool depends on the LLM choosing to call it. Spec §1: "If any of these mechanisms are skipped or watered down…" — a tool the LLM can skip is exactly the watered-down failure mode. JSON-then-render is unskippable: there is no markdown unless validation passes.
2. **Mechanical override matches spec §3.** Spec §3 says Validation Checks "**override**" verdict math — that is a server-side mechanical action, not a model judgment.
3. **Avoids the LLM grading its own homework.** Asking the same model to call its own validator post-hoc creates a high-skip-rate path (it has already "finished" the report).
4. **The markdown the user pastes into Notion is the LAST step**, generated by deterministic code from the validated JSON. The user-facing artifact is identical in shape to spec §5; the structural guarantees are now load-bearing.

**Trade-off accepted (see Risks):** the master prompt becomes "produce this JSON" instead of "produce this markdown." Mitigation: the renderer is deterministic and tested against the spec §5 artifact shape — pasteability is preserved by construction, not by hoping the LLM does it.

#### T05 — Define `ValidationReport` types module
- **Goal:** New `src/types/report.ts` with TypeScript interfaces matching spec §5 exactly: `Header`, `GateBlock { name, status: 'Pass'|'Fail'|'Inconclusive', confidence: 'High'|'Medium'|'Low', dok1: SourcedFact[], dok2: string, dok3: Insight[], dok4: string, contradicting: ContradictingEvidence[], source_meta }`, `ValidationCheck { name, rows, outcome: 'No issues'|'Minor'|'Major'|'Fundamental' }`, `TestCard`, `SourceAppendixEntry`, `ValidationReport { header, verdict, gates: GateBlock[5], validation_checks: ValidationCheck[3], test_cards, spiky_pov: SpikyPOVTemplate, source_appendix, methodology_notes }`. The `SpikyPOVTemplate` type is a literal string-shape stripping any populated POV content.
- **Files:** `src/types/report.ts` (new, ~120 lines)
- **Spec refs:** §5 full artifact spec, §6.1 master workflow output shape.
- **Acceptance:**
  - Types compile under `tsc --strict` with no `any`.
  - Every section in spec §5 (1–8) has a corresponding field on `ValidationReport`.
  - `SourcedFact` requires `{ text, source_url, tier, bias, fetched_at }` (no optional fields — spec §4 runtime requirement).
- **Dependencies:** none
- **Complexity:** M

#### T06 — Define `ValidationReport` zod schema (parses raw LLM JSON output)
- **Goal:** New `src/lib/report-schema.ts` exporting `ValidationReportSchema` (zod). Mirrors T05 types but with runtime validation: each `SourcedFact.tier` is `z.enum(['S','A','B','C','D'])`, each `bias` is `z.enum(['independent','vendor-funded','conflicted','unknown'])`, gate count is exactly 5 (`.length(5)`), validation_checks count is exactly 3, `spiky_pov` is `z.literal(SPIKY_POV_BLANK_TEMPLATE)`. Export `parseValidationReport(raw: unknown): { ok: true; report: ValidationReport } | { ok: false; errors: string[] }`. **`unknown` bias is accepted at parse time** — the bias-math conversion is the validator's job (T08), not the schema's.
- **Files:** `src/lib/report-schema.ts` (new, ~150 lines)
- **Spec refs:** §4 runtime requirement (every fact must have tier+bias+url+fetched_at); §5 artifact structure; spec §1 mechanism 5 (blank POV).
- **Acceptance:**
  - `parseValidationReport({})` returns `{ ok: false, errors: [...] }` with a non-empty error list.
  - A minimal valid report parses and round-trips through `JSON.stringify`/parse without loss.
  - Schema rejects 4 or 6 gates; rejects 2 or 4 validation checks; rejects any DOK 1 fact missing `tier`.
- **Dependencies:** T05
- **Complexity:** M

#### T07 — Structural validator: DOK separation + Contradicting Evidence + blank POV (closes H1, H2)
- **Goal:** New `src/lib/report-validator.ts` exporting `validateStructure(report: ValidationReport): StructuralIssue[]`. Rules:
  1. **DOK 1 non-empty per gate** — at least 1 sourced fact in `dok1`. (spec §5 "DOK 1 — Facts (raw, sourced)")
  2. **DOK 2 non-empty per gate** (plain restatement). (spec §6.1 Step 1c)
  3. **DOK 3 non-empty per gate AND each insight carries the model-judgment label** (string contains "⚠️" or `is_model_judgment: true` field). (spec §6.1 OPERATING RULE 2 + §5)
  4. **DOK 4 non-empty per gate** with verdict ∈ {Pass, Fail, Inconclusive}. (spec §3)
  5. **Contradicting Evidence block present per gate** — either ≥1 entry OR the explicit "No contradicting evidence surfaced — treat as a gap, not confirmation." sentinel string. (spec §1 mechanism 3 + §6.1 Step 1e)
  6. **Spiky POV equals the canonical blank template** — byte-for-byte match against `SPIKY_POV_BLANK_TEMPLATE` constant. (spec §1 mechanism 5 + Appendix B(4))
- **Files:** `src/lib/report-validator.ts` (new, ~120 lines); `src/lib/spiky-pov-template.ts` (new constant, ~20 lines)
- **Spec refs:** §1 mechanisms 2, 3, 5; §5 artifact; §6.1 Step 1e + Step 6; Appendix B(4); §11 anti-patterns 1, 4.
- **Acceptance:**
  - Synthetic report missing DOK 3 in Gate 2 returns at least one `StructuralIssue` mentioning Gate 2 + DOK 3.
  - Synthetic report with populated Spiky POV returns a `StructuralIssue` keyed `spiky_pov_violation` — the matching is byte-for-byte, no fuzzy compare.
  - Synthetic report with neither contradicting entries nor the sentinel string returns a `StructuralIssue` per offending gate.
- **Dependencies:** T05, T06
- **Complexity:** M

#### T08 — Verdict validator: source-count + decision-matrix overrides (closes H4, H5)
- **Goal:** Extend `src/lib/report-validator.ts` with `validateVerdicts(report: ValidationReport, bias): VerdictAdjustment[]` and `applyAdjustments(report, adjustments): ValidationReport`. Rules (spec §3 + §4):
  1. **PASS requires ≥2 tier-B-or-higher sources per gate.** Count `dok1` facts with tier ∈ {S, A, B}. If `< 2` and status === 'Pass' → downgrade to **Inconclusive** + record `verdict_downgrade_source_count`. (spec §4 rule 1)
  2. **D-tier never validates.** If a gate's PASS-supporting facts include any D-tier source as a deciding source, exclude it from the count for rule 1. (spec §4 rule 3)
  3. **`conflicted` > 30% of deciding-tier sources → downgrade gate confidence one level.** Use `effectiveBias()` from T03 for the count (so `unknown` is treated as `vendor-funded`, not `conflicted` — but the 30% rule is conflicted-specific). (spec §4 rule 2)
  4. **Validation Check decision matrix** (spec §3 + §6.1 Step 3):
     - All `outcome === 'No issues'` → render verdict as calculated.
     - Any `Minor` → render verdict, add caveat note.
     - Any `Major` → downgrade **overall** confidence to **Low**.
     - Any `Fundamental` → **override overall verdict to "Inconclusive — re-run with better sources"**, regardless of fail-2 math.
  5. **Fail-2 math runs FIRST, then overrides** (Appendix B(5) — order is mechanical-then-override). The validator implements that order explicitly.
- **Files:** `src/lib/report-validator.ts` (extend, ~150 lines added); fixture `src/lib/__fixtures__/synthetic-report.ts` for self-tests
- **Spec refs:** §3 verdict math; §4 rules 1–4; §6.1 Step 3 + Step 4; Appendix B(5); §11 anti-patterns 3, 5.
- **Acceptance:**
  - Synthetic report with a Gate 1 PASS but only 1 tier-B source → adjustment downgrades Gate 1 to Inconclusive.
  - Synthetic report with any check `outcome === 'Fundamental'` → final verdict string is `Inconclusive — re-run with better sources`.
  - Order test: a report with 3 fails AND a Fundamental flaw renders as Inconclusive, not NO-GO (override happens after math).
- **Dependencies:** T03, T05, T06, T07
- **Complexity:** L

#### T09a — Markdown renderer module
- **Goal:** New `src/lib/report-renderer.ts` exporting `renderReport(report: ValidationReport): string` that emits markdown matching spec §5 exactly. Section mapping (one renderer fn per section):
  1. `renderHeader` — `Idea:` + audience + builder block.
  2. `renderVerdict` — verdict above-the-fold.
  3. `renderGates` — per-gate DOK blocks (`Gate 1:` through `Gate 5:`).
  4. `renderValidationChecks` — `Validation Checks` section.
  5. `renderTestCards` — `What Would Change This` section.
  6. `renderSpikyPOV` — **always** emits `SPIKY_POV_BLANK_TEMPLATE` constant, regardless of `report.spiky_pov`. Defense-in-depth against T07 bypass.
  7. `renderSourceAppendix` — `Source Appendix` with full tier+bias+fetched_at per URL.
  8. `renderMethodologyNotes` — `Methodology Notes` section, including the mandatory `Tool calls fired: N` structured line (consumed by T19/T20).
- **Files:** `src/lib/report-renderer.ts` (new, ~250 lines)
- **Spec refs:** §5 artifact spec (all 8 sections); §6.1 Step 6.
- **Acceptance:**
  - Render a synthetic valid report; assert the output contains the 8 spec §5 section headings — exact heading text — in order: `Idea:`, `Verdict`, `Gate 1:`, `Gate 2:`, `Gate 3:`, `Gate 4:`, `Gate 5:`, `Validation Checks`, `What Would Change This`, `Your Spiky POV`, `Source Appendix`, `Methodology Notes`. Implemented as eight `assert(output.indexOf(heading) > prev_index)` checks in `src/lib/__fixtures__/renderer-self-test.ts`.
  - Rendered Spiky POV section is byte-identical to `SPIKY_POV_BLANK_TEMPLATE` even when input `report.spiky_pov` is populated (regression test for defense-in-depth).
  - `Tool calls fired: N` appears exactly once in the Methodology Notes section (grep returns 1).
- **Dependencies:** T05, T06, T07, T08
- **Complexity:** L

#### T09b — `finalize_validation_report` tool + registration in `src/index.ts`
- **Goal:** New MCP tool `src/tools/finalize-validation-report.ts` that the prompt invokes with the JSON string. Server-side pipeline: `parseValidationReport` (T06) → `validateStructure` (T07) → `validateVerdicts` (T08) → `applyAdjustments` (T08) → `renderReport` (T09a). Behavior contract:
  - On parse failure: return `ToolResult { ok: false, confidence_note: "<errors joined>", body: "" }`. **Cap finalize-retry attempts at 2 across a single `validate_idea` run** via a per-run retry counter encoded in the tool input (`attempt: number`). On `attempt >= 2` with a still-failing parse, return `{ ok: false, error: "validation_failed", confidence_note: "Two finalize attempts failed schema parse. Aborting to preserve tool budget." }` and do NOT render fabricated markdown.
  - On structural issues: return `{ ok: false, issues: StructuralIssue[], body: "" }` — empty markdown body by design; prompt may re-attempt once (subject to the cap).
  - On success: return `{ ok: true, body: renderedMarkdown, source_appendix_index: ... }`.
  - Register tool in `src/index.ts`.
- **Files:** `src/tools/finalize-validation-report.ts` (new, ~120 lines); `src/index.ts` (register tool, ~2 lines)
- **Spec refs:** §6.1 Step 7; Appendix B(3) (provenance at tool layer); §11 anti-patterns 1, 5; §11 DoD tool budget ≤20.
- **Acceptance:**
  - Tool registered in `src/index.ts` and appears in startup log.
  - Called with malformed JSON returns `ok: false` + parse errors in `confidence_note`; markdown body is empty string.
  - Called with structural-fail JSON returns issue list; markdown body is empty.
  - Calling with `attempt: 2` and parse failure returns `error: "validation_failed"` and an empty body — no fabricated markdown under any path. Asserted by unit fixture.
- **Dependencies:** T09a
- **Complexity:** M

#### T09c — `validate_idea` prompt rewrite to JSON-only output (closes markdown-emission escape hatch)
- **Goal:** Modify `src/prompts/validate-idea.ts` so the master workflow's terminal instruction is JSON-only and the markdown-emission path is structurally absent from the prompt.
  - **Step 7 final text** becomes: *"Emit your final output as a single JSON code block matching the `ValidationReport` schema (resource: `report-schema`). Then call `finalize_validation_report` with that JSON. The server validates and renders the markdown artifact. **Do not output any markdown report yourself. Do not narrate, summarize, or describe the report in markdown. Your final assistant message must contain exactly one fenced JSON block and the `finalize_validation_report` tool call. If you find yourself about to write `# Idea:` or `Verdict:` or any spec §5 heading, stop and emit JSON instead.**"*
  - Delete any prior example markdown report that previously appeared after Step 6/7 (the prompt currently contains a §5-shaped example illustrating output — remove it; the schema resource is the contract now).
  - Add a `<retry_policy>` block: "If `finalize_validation_report` returns `ok: false`, fix the JSON per the returned issues and call it again. Maximum 2 attempts per run. If both fail, surface the validation_failed error to the user — do not fabricate a markdown report."
- **Files:** `src/prompts/validate-idea.ts` (modify Steps 6 + 7, delete example markdown report, add retry policy block; ~80 lines changed net)
- **Spec refs:** §1 (anti-watering-down); §6.1 Steps 6–7; §11 anti-patterns 1, 5.
- **Acceptance:**
  - `src/prompts/validate-idea.ts` Step 7's final instruction states that JSON-only output is required; the prompt does not invite or describe direct markdown output.
  - No example markdown report follows Step 7. Mechanical check: `grep -n "^# Idea:\\|^## Verdict\\|^Gate 1:" src/prompts/validate-idea.ts` returns no matches inside the prompt body (only inside string literals used in `finalize_validation_report`'s schema description if at all).
  - Grep check: `grep -c "Do not output any markdown" src/prompts/validate-idea.ts` returns ≥ 1.
  - Grep check: `grep -c "Maximum 2 attempts" src/prompts/validate-idea.ts` returns ≥ 1.
  - Prompt contains an explicit instruction to invoke `finalize_validation_report` with the JSON; the model has no described path to deliver markdown without going through that tool.
- **Dependencies:** T09a, T09b
- **Complexity:** M

---

### Stream C — H3 `effectiveBias()` Helper

Small, must land before T08 finalizes (T08 depends on it). Spec §4 rule 4 + §11 anti-pattern 6: `unknown → vendor-funded` for confidence math.

#### T03 — Add `src/lib/bias.ts` helper module
- **Goal:** New module exporting:
  - `effectiveBias(flag: BiasFlag): BiasFlag` — returns `'vendor-funded'` when input is `'unknown'`, else passes through. (spec §4 rule 4)
  - `requiresUpgradeFromUnknown(sources: ToolSource[]): boolean` — true if any source has `bias === 'unknown'` (signals to caller they should try to upgrade before locking in math).
  - `conflictedRatio(sources: ToolSource[]): number` — fraction whose `effectiveBias` is `'conflicted'`. Returns the >30% test as `conflictedRatio(s) > 0.3`. (spec §4 rule 2)
  - `decidingTierSources(sources: ToolSource[]): ToolSource[]` — filters to S/A/B (deciding tiers). D-tier never validates (spec §4 rule 3).
- **Files:** `src/lib/bias.ts` (new, ~60 lines)
- **Spec refs:** §4 rules 1, 2, 3, 4; §11 anti-pattern 6.
- **Acceptance:**
  - `effectiveBias('unknown') === 'vendor-funded'` and `effectiveBias('independent') === 'independent'`.
  - `conflictedRatio` on 4 sources where 2 are `conflicted` returns `0.5`.
  - `decidingTierSources` excludes D-tier and only D-tier.
- **Dependencies:** none (must land before T08)
- **Complexity:** S

#### T04-audit — Pre-change audit: grep existing tools for `bias: 'unknown'`
- **Goal:** Before T04 modifies any code, run a structural audit to establish the true baseline so T04's "no behavior change" claim is verifiable. Commands:
  1. `grep -rn "bias: 'unknown'" src/tools/ > .planning/phases/01-anti-bias-hardening/audit-unknown-bias.txt`
  2. `grep -rn "bias: \"unknown\"" src/tools/ >> .planning/phases/01-anti-bias-hardening/audit-unknown-bias.txt`
  3. For each hit: classify as (a) "downstream upgrade to vendor-funded happens before math" — safe, T04 is no-op; (b) "no upgrade, math runs on `unknown`" — T04 IS a behavior change for this site; record in audit file as "BEHAVIOR-CHANGE-SITE: <file:line>".
- **Files:** `.planning/phases/01-anti-bias-hardening/audit-unknown-bias.txt` (new, audit artifact)
- **Spec refs:** §4 rule 4; §11 anti-pattern 6.
- **Acceptance:**
  - Audit file exists and lists every `bias: 'unknown'` occurrence in `src/tools/`.
  - Each occurrence is classified `SAFE` or `BEHAVIOR-CHANGE-SITE`.
  - If any `BEHAVIOR-CHANGE-SITE` exists, T04's acceptance is updated (in commit) to enumerate which output strings legitimately change. If audit shows zero sites, the original "no behavior change" line stays.
- **Dependencies:** T03 (audit precedes T04)
- **Complexity:** S

#### T04 — Wire `effectiveBias` into existing tools doing confidence math
- **Goal:** Apply `effectiveBias()` everywhere a tool reasons about source bias (currently mostly the LLM does this, but several tools generate `confidence_note` strings based on source mix). Replace inline checks with `effectiveBias()` calls. Audit targets per T04-audit output + CONCERNS.md H3:
  - `src/tools/find-pricing-anchors.ts:155` (already touched by T02 — verify the new Wayback sources use `'independent'` correctly, not `'unknown'`).
  - `src/tools/check-big-tech-encroachment.ts:172, 245` (hardcoded `'independent'` and `'conflicted'` — verify these are correct per spec §4 source-type heuristics; do not blanket-change).
  - Anywhere a tool computes `confidence_note` based on source counts — route the count through `effectiveBias` so `unknown` sources don't silently boost confidence.
  - For each `BEHAVIOR-CHANGE-SITE` flagged in T04-audit's artifact, this task either fixes it (preferred — `unknown` → upgrade explicitly to `vendor-funded` before math) or files a follow-up task `T04-followup-<n>` with the specific file:line.
- **Files:** `src/tools/find-pricing-anchors.ts`, `src/tools/check-big-tech-encroachment.ts`, and any other tool the audit surfaces (expect 2–4 total)
- **Spec refs:** §4 rule 4; Appendix B(3) tool-layer provenance; §11 anti-pattern 6.
- **Acceptance:**
  - `grep -rn "bias.*unknown" src/tools/` shows no tool reasoning about `unknown` without going through `effectiveBias`.
  - For each `BEHAVIOR-CHANGE-SITE` in the audit artifact, either the diff fixes it OR a follow-up task exists. (Mechanical check: each audit-flagged site has a matching commit message reference OR a TODO comment naming the follow-up task ID.)
  - Audit file is updated post-commit to mark each site `RESOLVED` or `FOLLOWUP-<task-id>`.
- **Dependencies:** T03, T04-audit
- **Complexity:** S

---

### Stream D — H6 Four Remaining Tools

Built in spec §10 order. Each tool must use `effectiveBias()` from T03 (mandatory per spec Appendix B(3) + §11 anti-pattern 6). Each tool must return the standard `ToolResult<T>` shape (spec §7). Each must follow CONVENTIONS.md "Graceful Degradation" — `isXxxLive()` quartet for any new API.

Order is sequential, not parallel, because the patterns evolve: the first tool sets the conventions for `effectiveBias` integration; later tools refine; the last two introduce new lib clients (GitHub, Reddit-about-json) that benefit from settled patterns.

#### T10 — Build `find_why_now_signals` (Gate 5 primary)
- **Goal:** New tool returning recent enablers (new APIs, model capabilities, regulatory shifts in last 24mo), YC RFS additions touching category (reuse `src/tools/find-yc-rfs-alignment.ts` data or share the static dataset), macro Google Trends shifts in supply-side terms (via Serper search with date-restricted queries; no dedicated Trends API for v1 — spec §7 lists Trends as A-tier, current best-effort is search-snippet inference, noted in `confidence_note`).
- **Output shape (`ToolResult<{ enablers: Enabler[], rfs_alignment: RFSHit[], trends_notes: string[] }>`):**
  - `Enabler { description, source_url, date_iso, category: 'api'|'model_capability'|'regulatory'|'platform_change' }`
  - Source tiers per spec §7: dev docs / regulatory pages = S/independent; Serper aggregates of news = A/independent; RFS = A/independent (it's YC's own page = `conflicted` actually — see spec §4 rule 6; **use `conflicted` for YC RFS as a positioning signal**).
- **Files:** `src/tools/find-why-now-signals.ts` (new, ~250 lines); `src/index.ts` (register).
- **Spec refs:** §7 tool entry (lines 543-547); §10 build order (item 3); §1 mechanism 1 (tool-layer tier+bias); Appendix B(3).
- **Acceptance:**
  - Returns at least 3 candidate enablers when called with a real category (e.g. "AI focus app deep work").
  - All sources carry tier + bias + fetched_at; no `tier: 'A'` source for a stub Serper response (must downgrade to D when key absent per existing convention).
  - Uses `effectiveBias()` anywhere it reasons about source mix in `confidence_note`.
  - Registered in `src/index.ts` and the startup log lists it.
- **Dependencies:** T03
- **Complexity:** L

#### T11 — Wire `find_why_now_signals` into tool-to-gate map resource + prompt
- **Goal:** Update `src/resources/tool-to-gate-map.md` to reflect that Gate 5 now has a primary tool (was previously empty for primary). Update `src/prompts/validate-idea.ts` if it explicitly names tools for Gate 5 (it shouldn't per the convention of "model selects from map," but verify). Update the Methodology Notes section of the renderer (T09a) to handle the new tool name.
- **Files:** `src/resources/tool-to-gate-map.md`, possibly `src/prompts/validate-idea.ts`, possibly `src/lib/report-renderer.ts`
- **Spec refs:** §7 Tool-to-Gate map (table).
- **Acceptance:** `tool-to-gate-map.md` shows `find_why_now_signals` with **P** in G5 column.
- **Dependencies:** T10
- **Complexity:** S

#### T12a — Build `src/lib/github.ts` client
- **Goal:** New `src/lib/github.ts` exposing the quartet:
  - `isGithubLive(): boolean` — true iff `process.env.GITHUB_TOKEN` is set.
  - `searchRepos(keywords: string[], limit: number): Promise<GithubRepoStub[]>` — hits `/search/repositories?q=…`.
  - `repoStats(owner: string, repo: string): Promise<GithubRepoStats>` returning stars / commits-last-90d / contributor count / last-commit-date.
  - `githubSource(repo): ToolSource` returning tier `'S'`, bias `'independent'` (per spec §4: code repos are independent signal).
- **Files:** `src/lib/github.ts` (new, ~120 lines)
- **Spec refs:** §7 graceful-degradation; spec §4 source tiers; Appendix B(3).
- **Acceptance:**
  - With `GITHUB_TOKEN` set, `repoStats('vercel', 'next.js')` returns real numeric stars and last-commit date.
  - Without `GITHUB_TOKEN`, `isGithubLive()` returns `false`; calling `searchRepos` throws a typed `GithubNotConfigured` error caught by callers.
  - `githubSource` returns a `ToolSource` matching the standard shape (tier+bias+fetched_at+source_url all required).
- **Dependencies:** T03
- **Complexity:** M

#### T12b — Extend `src/lib/reddit.ts` with `getSubredditMeta()`
- **Goal:** Add a no-auth subreddit metadata fetcher. Hits `https://www.reddit.com/r/<sub>/about.json` (public, no OAuth) and returns `{ subscribers: number, active: number, created_utc: number } | null`. Tier `'A'`, bias `'independent'` per spec §4. Does NOT replace the existing Serper-site-search content extraction — adds the subscriber-count signal Serper cannot return (CONCERNS.md M7).
- **Files:** `src/lib/reddit.ts` (extend — add `getSubredditMeta(name)` and `subredditMetaSource(meta)`, ~50 lines added)
- **Spec refs:** §7 tool entry; spec §4 source tiers (Reddit = A/independent for subscriber data); CONCERNS.md M7.
- **Acceptance:**
  - `getSubredditMeta('getdisciplined')` returns a non-null object with `subscribers >= 0` (real network call).
  - `getSubredditMeta('definitely-not-a-real-sub-12345')` returns `null` (404 handled, does not throw).
  - Returned `subredditMetaSource()` has tier `'A'`, bias `'independent'`, `fetched_at` set to current ISO timestamp.
- **Dependencies:** T03
- **Complexity:** S

#### T12c — Build `estimate_demand_signals` tool wiring T12a + T12b
- **Goal:** New tool wiring GitHub + Reddit metadata + Serper-aggregated trends into the spec §7 demand-signal contract.
  1. GitHub: `searchRepos` for category-relevant repos; `repoStats` per repo.
  2. Reddit: `getSubredditMeta` for category-relevant subs (heuristic keyword → sub-name map).
  3. Google Trends signal: **deferred for v1** — log in `confidence_note` as "Trends signal not available; demand inferred from GitHub + Reddit + competitor traffic." (See Risks §"estimate_demand_signals complexity.")
  4. SimilarWeb fallback: if `SIMILARWEB_API_KEY` not set, skip and note in `fallbacks_used` (spec §7 paid-API fallback contract).
- **Output shape:** `ToolResult<{ subreddits: SubredditSignal[], github_repos: GithubRepoSignal[], competitor_traffic: TrafficSignal[] | null, trends_notes: string[] }>`.
- **Files:** `src/tools/estimate-demand-signals.ts` (new, ~280 lines); `src/index.ts` (register).
- **Spec refs:** §7 tool entry (lines 528-532); §10 build order (item 2); CONCERNS.md M7 / H6.
- **Acceptance:**
  - With `GITHUB_TOKEN` set, returns real stars/commit data for at least one repo in the queried category.
  - Without `GITHUB_TOKEN`, falls back gracefully (no throw), records the fallback in `fallbacks_used`, downgrades the relevant source from S to D.
  - Subreddit size fetch returns real subscriber counts for known subs (e.g. `r/getdisciplined`).
  - All sources tagged with tier + bias + fetched_at; uses `effectiveBias()` for any mix-based reasoning.
  - Registered in `src/index.ts`.
- **Dependencies:** T12a, T12b, T10 (Stream D sequential per spec §10)
- **Complexity:** L

#### T13 — Wire `estimate_demand_signals` into tool-to-gate map
- **Goal:** Update `src/resources/tool-to-gate-map.md`: G2 column → P for `estimate_demand_signals`; G5 column → s.
- **Files:** `src/resources/tool-to-gate-map.md`
- **Spec refs:** §7 Tool-to-Gate map.
- **Acceptance:** Map shows P/s correctly.
- **Dependencies:** T12c
- **Complexity:** S

#### T14 — Build `find_public_revenue_signals` (Gate 2 + Gate 4 primary)
- **Goal:** New tool surfacing public revenue from comparables. Spec §7: IndieHackers public revenue entries (via Serper `site:indiehackers.com`), founder MRR tweets (via Serper `site:x.com OR site:twitter.com` with `MRR OR ARR` keyword), SEC filings (via Serper `site:sec.gov 10-K <category>`), OpenStartup pages (via Serper general search filtered to `openstartup.com` if domain exists; if not, drop with a note in `confidence_note`).
- **Output shape:** `ToolResult<{ indiehackers: RevenueSignal[], founder_tweets: RevenueSignal[], sec_filings: RevenueSignal[], openstartup: RevenueSignal[] }>` where `RevenueSignal { source_handle_or_company, claimed_revenue, period, url, captured_text }`.
- **Tiers per spec §7:** SEC = S/independent; IndieHackers = A/independent; founder tweets = A/conflicted (founder has a stake — spec §4 rule 6); OpenStartup = S/independent.
- **Files:** `src/tools/find-public-revenue-signals.ts` (new, ~250 lines); `src/index.ts` (register).
- **Spec refs:** §7 tool entry (lines 550-554); §10 build order (P1 item 5); Appendix B(3).
- **Acceptance:**
  - Returns at least one entry across the four source families for a real category.
  - Founder-tweet entries tagged `bias: 'conflicted'`, not `'independent'`.
  - SEC entries tagged `bias: 'independent'`, tier S.
  - Tool budget self-check: ≤4 Serper calls total per invocation (one per source family).
- **Dependencies:** T03, T12c (sequential per spec §10)
- **Complexity:** L

#### T15 — Wire `find_public_revenue_signals` into tool-to-gate map
- **Goal:** Update map: G2 column → P (alongside `estimate_demand_signals`); G4 column → P; G1 column → s.
- **Files:** `src/resources/tool-to-gate-map.md`
- **Spec refs:** §7 Tool-to-Gate map.
- **Acceptance:** Map updated.
- **Dependencies:** T14
- **Complexity:** S

#### T16 — Build `assess_platform_dependency` (Gate 3 primary)
- **Goal:** New tool that (a) extracts platform references from the idea description (heuristic keyword match against a static list: Twitter/X API, Shopify, App Store, Play Store, Chrome Web Store, OpenAI API, Anthropic API, Stripe, Slack, Apple Intelligence, Screen Time API, Focus Modes, Digital Wellbeing, etc.), (b) for each detected platform, fetches recent ToS-change news (`site:<platform-domain> terms` + Serper general `<platform> ToS change <year>`), (c) finds deplatforming retros from founders (`<platform> deplatform OR shutdown OR ban site:medium.com OR site:news.ycombinator.com`).
- **Output shape:** `ToolResult<{ platforms_detected: PlatformDep[], tos_changes: ToSChange[], deplatforming_retros: Retro[] }>`.
- **Tiers per spec §7:** official ToS pages = S/conflicted (platform has stake — spec §4 rule 6); founder retros = A/conflicted (founder stake against platform); news aggregations = A/independent.
- **Files:** `src/tools/assess-platform-dependency.ts` (new, ~280 lines); `src/lib/platform-keywords.ts` (new static list, ~50 lines — must include Apple Intelligence, Screen Time API, Focus Modes, Digital Wellbeing terms); `src/index.ts` (register).
- **Spec refs:** §7 tool entry (lines 556-561); §10 build order (P1 item 6); Appendix B(3).
- **Acceptance:**
  - Given idea "AI-native focus app on iOS," detects `App Store`, `Screen Time API`, and `Apple Intelligence` in `platforms_detected`.
  - Given idea "Twitter automation tool," detects `Twitter/X API`.
  - ToS pages tagged `bias: 'conflicted'`, not `'independent'`.
  - `grep -E "Apple Intelligence|Screen Time API|Focus Modes|Digital Wellbeing" src/lib/platform-keywords.ts` returns ≥4 matches.
- **Dependencies:** T03, T14 (sequential per spec §10)
- **Complexity:** L

#### T17 — Wire `assess_platform_dependency` into tool-to-gate map + startup log
- **Goal:** Update `src/resources/tool-to-gate-map.md`: G3 column → P. Update `src/index.ts` console.error startup log to list all 12 tools.
- **Files:** `src/resources/tool-to-gate-map.md`, `src/index.ts`
- **Spec refs:** §7 Tool-to-Gate map.
- **Acceptance:** Map shows P; startup log lists 12 tools.
- **Dependencies:** T16
- **Complexity:** S

---

### Stream E — H7 Critical Test Calibration

Final gating check. Cannot run meaningfully until Streams A–D are complete, because each closes a path by which the LLM could fabricate a GO verdict on the focus-app idea.

#### T18 — Create `.planning/validation-runs/` directory + README
- **Goal:** New directory holding regression artifacts from real `validate_idea` runs. Include a one-paragraph `README.md` explaining the purpose (calibration anchor per spec §11 Critical Test) and the naming convention `NN-<idea-slug>.md`.
- **Files:** `.planning/validation-runs/README.md` (new, ~30 lines)
- **Spec refs:** §10 Phase 4; §11 DoD.
- **Acceptance:** Directory + README exist; README references spec §10/§11.
- **Dependencies:** T02, T09c, T17 (all streams must have shipped before a meaningful run)
- **Complexity:** S

#### T19 — Run `validate_idea` against the Fomi case + capture artifact
- **Goal:** Manually (or via a scripted MCP client) invoke `validate_idea` with the canonical Fomi-equivalent input from `framework-context.md` §6:
  - `idea`: "AI-native focus app that monitors your screen via cloud screenshots and intervenes when you drift off-task. Desktop-first, individual users."
  - `audience`: `B2C`
  - `builder`: `solo`
  Capture the full markdown artifact emitted by `finalize_validation_report` (T09b) and save to `.planning/validation-runs/01-fomi-focus-app.md`. The captured artifact MUST include a structured tool-call-count line `Tool calls fired: N` inside the Methodology Notes section (emitted by T09a's `renderMethodologyNotes`) so T20 can grep it mechanically.
- **Files:** `.planning/validation-runs/01-fomi-focus-app.md` (new, ~800-1500 lines of generated markdown)
- **Spec refs:** §10 Phase 4 Critical Test; §11 DoD; `framework-context.md` §6 (calibration anchor).
- **Acceptance:**
  - File exists and contains all 8 sections of spec §5.
  - Spiky POV section is the canonical blank template (byte-match).
  - Every DOK 1 fact has tier + bias + fetched_at.
  - `grep -E "^Tool calls fired: [0-9]+$" .planning/validation-runs/01-fomi-focus-app.md` returns exactly 1 line, with N ≤ 20 (per §11 DoD).
- **Dependencies:** T18
- **Complexity:** M

#### T20 — Assert verdict is NO-GO with sourced killshots; otherwise route to failure mode
- **Goal:** Inspect the captured artifact from T19 with a mechanical assertion script (e.g. `scripts/assert-fomi-run.ts` or an inline checklist with `grep`-style commands). Assertions:

  1. **Overall verdict is NO-GO.** Mechanical: `grep -E "^## Verdict:?\s*NO-GO" .planning/validation-runs/01-fomi-focus-app.md` returns ≥1 line. Spec §11.

  2. **At least 2 killshot reasons cite tier-S or tier-A sources — verified mechanically by parsing.** Implementation:
     - Parse the rendered `Source Appendix` section into a map `url → tier`.
     - Parse the killshot list (the bullet list under the Verdict block referencing source URLs).
     - For each killshot reason, extract the cited source URL(s).
     - Assert at least 2 distinct cited URLs have `tier ∈ {S, A}` in the appendix map.
     - This is a `scripts/assert-fomi-run.ts` mechanical check; no human eyeballing. If the script does not exist, T20 must include creating it.

  3. **At least one Gate 3 DOK 1 fact references Apple Intelligence / Screen Time API / Focus Modes / Digital Wellbeing.** Mechanical: extract Gate 3's DOK 1 fact list from the report; assert at least one fact's text or source_url contains a case-insensitive match for one of: `apple intelligence`, `screen time api`, `focus mode`, `digital wellbeing`. Catches the H6 vs M5 boundary case (CONCERNS.md M5).

  4. **Killshots align with the framework-context.md §6 case** — at least two of: cloud-screenshot privacy gap, Apple Intelligence / Screen Time encroachment (Gate 3), <$10/mo WTP ceiling (Gate 4), ADHD-tax churn pattern. The verdict need not name "Fomi" specifically, but the structural concerns must be present. (Inherently qualitative — flagged as human-judged in the assertion script's output.)

  **If all assertions pass:** mark the phase done. Add a `## Result: PASS` block to `.planning/validation-runs/01-fomi-focus-app.md` with the assertion results and date.

  **If any assertion fails:** create `.planning/validation-runs/01-fomi-focus-app-FAILURE.md` with:
  - Which assertion failed.
  - Hypothesis of the responsible stream (Stream B if Spiky POV got filled or DOK layers blurred; Stream C if `unknown` sources weren't downgraded; Stream D if Gate 3/4 had no primary tool data; etc.).
  - Specific code paths to revisit.

  Then route back to the responsible stream. This task is **gating** — the phase is not done until T20 passes.
- **Files:** `scripts/assert-fomi-run.ts` (new, ~150 lines); `.planning/validation-runs/01-fomi-focus-app.md` (append PASS block) OR `.planning/validation-runs/01-fomi-focus-app-FAILURE.md` (new)
- **Spec refs:** §10 Phase 4 ("If GO, there's a bug"); §11 DoD; `framework-context.md` §6.
- **Acceptance:**
  - `scripts/assert-fomi-run.ts` exists and exits 0 on a passing run, non-zero on failure with the failed-assertion id in stderr.
  - Either a PASS block is appended, or a FAILURE doc exists and the corresponding stream has a follow-up task.
  - Assertion 2's source-tier check is implemented in code; no "human reads the report" step.
  - Assertion 3's Apple-encroachment keyword check is implemented in code; runs against Gate 3's parsed DOK 1 facts.
- **Dependencies:** T19
- **Complexity:** M

#### T21 — Mark CONCERNS.md H1–H8 resolved (or document residuals)
- **Goal:** Update `.planning/codebase/CONCERNS.md`: for each of H1–H8, add a `**Resolved 2026-MM-DD by Phase 01 (task T0X)**` line. If T20 produced a FAILURE doc, do NOT mark the implicated concern resolved — instead note `Residual — see validation-runs/01-fomi-focus-app-FAILURE.md`.
- **Files:** `.planning/codebase/CONCERNS.md`
- **Spec refs:** none (planning hygiene).
- **Acceptance:** H1–H8 each have a resolved-or-residual annotation; phase 01 mentioned by name.
- **Dependencies:** T20
- **Complexity:** S

#### T22 — Update CONVENTIONS.md + ARCHITECTURE.md with new patterns
- **Goal:** Two small doc updates:
  1. `CONVENTIONS.md` — add a section "Report Validation Pipeline (spec §1 mechanisms 2-5 — MANDATORY)" describing the JSON-then-render flow introduced in Stream B. Cite `src/lib/report-validator.ts`, `src/lib/report-renderer.ts`, `src/tools/finalize-validation-report.ts`. Document the 2-retry cap.
  2. `ARCHITECTURE.md` — update the system overview diagram to include the validator/renderer step between Tools and Output; update the "12 Tools Status" table to mark all 12 as ✅ Built; update the "Anti-Bias Mechanisms" section to cite the code-side enforcement (T07, T08) for mechanisms 2, 3, 4, 5 (mechanism 1 was already enforced at the tool layer); note the MCP semver bump to 0.2.0 (see Risk 6).
- **Files:** `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/ARCHITECTURE.md`
- **Spec refs:** none (planning hygiene).
- **Acceptance:** Both docs reflect the post-phase-01 reality; semver bump documented.
- **Dependencies:** T20
- **Complexity:** S

---

## Dependency Graph

```
                                Stream A
                                  T01 ──▶ T02

  Stream C                       Stream B
   T03 ──┬──▶ T04-audit ──▶ T04   T05 ──▶ T06 ──┐
         │                                      ├──▶ T07 ──┐
         └──────────────────────────────────────┘          ├──▶ T08 ──▶ T09a ──▶ T09b ──▶ T09c
                                                           │
                                Stream D (sequential per spec §10)
                                  T10 ──▶ T11
                                   │
                                   ▼
                                  T12a ─┐
                                        ├──▶ T12c ──▶ T13          (T12c also depends on T10)
                                  T12b ─┘
                                   │
                                   ▼
                                  T14 ──▶ T15          (T14 also depends on T03, T12c)
                                   │
                                   ▼
                                  T16 ──▶ T17          (T16 also depends on T03, T14)

                                Stream E (gating)
   {T02, T09c, T17} ──▶ T18 ──▶ T19 ──▶ T20 ──┬──▶ T21
                                               └──▶ T22
```

**Critical path (longest):** T03 → T05 → T06 → T07 → T08 → T09a → T09b → T09c → (T10→T11→T12a→T12c→T14→T16→T17) → T18 → T19 → T20.

**New dependencies introduced by splits:**
- T09a → T09b → T09c (was monolithic T09). T09b cannot register the tool until T09a's renderer exists; T09c's prompt rewrite cannot reference `finalize_validation_report` until T09b registers it.
- T12a + T12b → T12c (was monolithic T12). T12c imports from both library modules.
- T04-audit precedes T04 (new node between T03 and T04 to make "no behavior change" claim verifiable).

**Parallelism opportunities:**
- T01 + T02 (Stream A) can run in parallel with all of Stream B and C — completely isolated.
- T03 can run in parallel with T05/T06 (no dependency between bias helper and report types).
- T12a and T12b are independent and can run in parallel once T03 lands; both must complete before T12c.
- Within Stream D, T11/T13/T15/T17 (the small "wire into map" tasks) can each immediately follow their parent tool task without blocking the next tool's start.
- T21 and T22 are independent leaf tasks after T20.

**Anti-parallelism (sequential per spec §10):** The four Stream D tools T10/T12c/T14/T16 must build in order. CONTEXT.md fix-order step 4 + spec §10 are explicit on this.

---

## Risks & Mitigations

### Risk 1: Restructuring `validate_idea` to emit structured JSON breaks Notion-pasteability
**Concern:** The spec §5 artifact is markdown for a reason — it pastes into Notion / Linear / Slack. If the prompt now emits JSON and the server renders markdown, two things could go wrong:
1. The rendered markdown drifts from spec §5 (renderer bug).
2. The user-facing output is delivered as raw JSON if the rendering step fails.

**Mitigation:**
- `renderReport` (T09a) is deterministic and table-driven against the spec §5 section structure. Each section in §5 maps to a single renderer function; the function signature is small enough to manually verify.
- `finalize_validation_report` returns the rendered markdown only after validation passes. If validation fails, the tool returns the issue list — the markdown body is empty by design (the prompt then re-tries, capped at 2 attempts per Risk 5 mitigation).
- T19 (the Fomi case run) is the integration test: if the markdown doesn't paste cleanly into Notion, T19 fails and we revisit T09a.
- The Spiky POV section is rendered from a constant template (T07's `SPIKY_POV_BLANK_TEMPLATE`) — not from LLM output — so it cannot be malformed.

### Risk 2: `estimate_demand_signals` complexity / scope creep
**Concern:** This is the biggest tool — multiple APIs (GitHub, Reddit, optionally SimilarWeb, optionally Trends). Risk of T12c ballooning into a multi-week task.

**Mitigation:**
- **MVP scope locked here:** GitHub stars/commits (S-tier when token present), Reddit subscriber counts via about.json (A-tier), Serper-aggregated trend snippets (A-tier when key present). That's it.
- **Pre-split executed:** T12 is split into T12a (github lib) + T12b (reddit extension) + T12c (tool wiring). Each is independently committable.
- **Explicitly deferred:** Google Trends API integration; SimilarWeb / Ahrefs paid integrations (graceful skip with `fallbacks_used`).

### Risk 3: H7 failure modes — NO-GO returned for the wrong reasons
**Concern:** A model could return NO-GO because it hallucinated a non-existent competitor, not because it surfaced the real cloud-screenshot / Screen Time / WTP problems. The verdict would pass T20's first assertion but fail the framework.

**Mitigation:** T20 has four assertions, not one:
1. Verdict is NO-GO (cheap mechanical grep).
2. Killshots cite tier-S or tier-A sources — **mechanical** check via `scripts/assert-fomi-run.ts` parsing the source appendix.
3. At least one Gate 3 DOK 1 fact references Apple Intelligence / Screen Time / Focus Modes / Digital Wellbeing — **mechanical** keyword check on parsed Gate 3 facts.
4. At least two killshots align with framework-context.md §6 case (privacy gap, Apple encroachment, WTP ceiling, churn) — human-judged.

Additionally, the source appendix produced by T09a lists every URL with its tier — if the killshot sources are all D-tier or fabricated, T20 assertion 2 fails and the FAILURE doc names "Stream B verdict validator didn't catch this" as the likely cause.

### Risk 4: Wayback CDX API is rate-limited or slow
**Concern:** T01's Wayback client hits a public API. If it's slow (>5s) or rate-limited, every `find_pricing_anchors` call gets slower.

**Mitigation:** Wayback CDX is fast (<1s usually) and unauthenticated. T01 wraps the fetch in a 3-second timeout and on failure surfaces `fallbacks_used: ['wayback (timeout)']` per the existing graceful-degradation pattern. `find_pricing_anchors` still returns useful data — the historical-pricing claim just won't be made.

### Risk 5: Tool budget overrun (≥20 calls per `validate_idea` run)
**Concern:** Spec §11 caps tool calls per run at <20. Adding 4 new primary tools + a potentially-retried `finalize_validation_report` risks crossing that.

**Mitigation:**
- Each new tool fires once per `validate_idea` per spec §7 tool-reuse rule (already in the prompt).
- 12 tools total but only ~8 are P-primary per run, plus a few `s` calls. Budget estimate: 8 P + 4 s + 1 `finalize_validation_report` (+ at most 1 retry, capped) = 13–14. Comfortably under 20.
- **Hard retry cap of 2 finalize attempts** enforced in T09b — on second parse-failure, return `validation_failed` to the client, never fabricate.
- T19 captures the actual count via the structured `Tool calls fired: N` line in Methodology Notes; if >20, M8 (cache wiring) gets prioritized for the next phase. Not blocking this phase.

### Risk 6: Existing `validate_idea` invocations are observationally different post-T09 (BREAKING CHANGE)
**Concern:** `validate_idea` is invoked by users in Claude Desktop today (LLM directly emits markdown). After T09c ships, the prompt requires the LLM to emit JSON and call `finalize_validation_report` — the server then renders markdown. Same prompt name (`validate_idea`), different observable protocol shape. Any user with cached invocation patterns, scripted MCP clients, or workflow examples that expect the old markdown-direct shape will see a behavior change.

**Mitigation:**
- T19 acts as the integration smoke test in a real MCP client (Claude Desktop or scripted). If protocol-shape change breaks the client interaction, T19 surfaces it.
- **Bump MCP server semver to 0.2.0** in `package.json` to signal the protocol-shape change to any consumer. T22 documents the change in CONVENTIONS.md and ARCHITECTURE.md.
- Update the `validate_idea` prompt's description text (the MCP-registered description) to note: "v0.2.0 — emits structured JSON; server renders the markdown artifact via `finalize_validation_report`." This is the discoverable signal for downstream consumers.

**Severity:** Warning-level — behavior is observably different, but the user-facing artifact (the final markdown) is shape-preserved by the renderer. No silent corruption; downstream pasting still works.

---

## Out of Scope (explicit, restated from CONTEXT.md)

- **M1–M9** tool quality issues (parser noise, domain guessing, conference search synonyms, PH topic search, Reddit OAuth, cache wiring, confidence-note math). These are tuning, not structural. Separate phase. Note: T02 *does* fix part of M3 by coincidence (Wayback URL no longer cited unfetched), and T12c *does* address M7's subscriber-count gap; this is bonus, not the goal.
- **L1** (no automated tests) — H7 calibration in Stream E is the end-to-end test for this phase. Unit tests for parsers are a follow-up phase.
- **L2** (stale branches) — housekeeping, do anytime.
- **L3** (Cursor / Claude Code smoke test) — pre-v1 distribution check, separate phase.
- **§12** spec open product questions (Failure-Mode Library, multi-turn, frontend, sharing) — post-v1.

---

## Definition of Done

Phase 01 ships when every box below is checked. Each box traces to specific task IDs.

- [ ] **H8 Wayback fabrication eliminated** — no tool returns S-tier sources for URLs it didn't fetch. → **T01, T02** + grep check from T02 acceptance.
- [ ] **Report Validator exists in code** and is invoked before the master prompt returns the artifact. → **T05, T06, T07, T08, T09a, T09b, T09c**. The `finalize_validation_report` tool is registered in `src/index.ts` and the `validate_idea` prompt instructs the model to call it with JSON-only output (no markdown escape hatch).
- [ ] **Report Validator rejects/downgrades** outputs missing DOK 1-4 separation, Contradicting Evidence block, blank Your Spiky POV section, ≥2 tier-B sources for any PASS. → **T07** (DOK + CE + POV), **T08** (≥2 tier-B + decision matrix).
- [ ] **Markdown-emission escape hatch closed** — `src/prompts/validate-idea.ts` Step 7 instructs JSON-only output; no example markdown report follows Step 7; prompt does not invite or describe direct markdown output. → **T09c** acceptance grep checks.
- [ ] **`effectiveBias()` helper exists** in `src/lib/bias.ts` and is used wherever confidence math touches sources. → **T03, T04-audit, T04**. Pre-change audit artifact exists; grep check post-T04 confirms no unmediated `unknown` reasoning.
- [ ] **All 12 tools per spec §7 exist.** → **T10** (`find_why_now_signals`), **T12c** (`estimate_demand_signals`, built on T12a/T12b), **T14** (`find_public_revenue_signals`), **T16** (`assess_platform_dependency`). Registration in `src/index.ts` confirmed by T17's startup-log update.
- [ ] **`validate_idea` invoked on the AI focus app idea returns NO-GO with sound reasoning** (spec §11 Critical Test). → **T19, T20**. Sound reasoning is operationally defined by T20's four assertions, with assertions 1–3 mechanically scripted in `scripts/assert-fomi-run.ts`.
- [ ] **NO-GO output is captured** as `.planning/validation-runs/01-fomi-focus-app.md` with a structured `Tool calls fired: N` line in Methodology Notes. → **T18, T19**.
- [ ] **Gate 3 coverage proven** — at least one Gate 3 DOK 1 fact references Apple Intelligence / Screen Time API / Focus Modes / Digital Wellbeing. → **T20 assertion 3**.
- [ ] **All concerns H1–H8 in `.planning/codebase/CONCERNS.md` can be marked resolved.** → **T21**. H1+H4 → T07+T08. H2 → T07+T09a. H3 → T03+T04. H5 → T08. H6 → T10+T12c+T14+T16. H7 → T18–T20. H8 → T01+T02.
- [ ] **Architecture + conventions docs reflect the new pipeline** including the MCP semver bump to 0.2.0. → **T22**.

---

## Changelog

- **v0.2 (2026-05-20)** — addressed PLAN-CHECK.md (1 blocker, 6 warnings, 1 info applied).
  - **Blocker:** T09c rewrites `validate-idea.ts` prompt to JSON-only; example markdown report deleted from prompt body; grep-verifiable acceptance criteria added.
  - **Warnings:** T09 split into T09a (renderer) / T09b (tool + register) / T09c (prompt rewrite). T12 split into T12a (github.ts) / T12b (reddit getSubredditMeta) / T12c (tool wiring). T09a acceptance replaced "eyeball" with explicit 8-section-heading existence check. T19 emits structured `Tool calls fired: N` line. T20 assertion 2 promoted to mechanical `scripts/assert-fomi-run.ts` source-tier parse. T20 assertion 3 added for Gate 3 Apple/Screen-Time keyword coverage. T04-audit task added as pre-change audit to validate "no behavior change" claim. Risk 6 added (observability/protocol-shape change + MCP semver bump to 0.2.0).
  - **Info applied:** T09b enforces a hard 2-attempt retry cap with explicit `validation_failed` error path.
  - **Info skipped (planner's discretion):** items 10 (T22 doc updates remain) and 12 (T11/T13/T15/T17 remain split — clearer audit trail).
- **v0.1 (2026-05-20)** — initial 22-task plan, PASS-WITH-CAVEATS from gsd-plan-checker.

---

*Phase plan v0.2. 28 tasks. Critical path: ~17 sequential tasks. Estimated total complexity: 9 S + 9 M + 10 L. Plan ready for execution.*
