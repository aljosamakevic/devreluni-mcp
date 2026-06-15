# Phase 09 — Tool envelope status discriminator

## Phase goal

Close the model-rationalization failure mode by adding a machine-readable `status` discriminator to every tool response envelope. Three values, exhaustive:

- `ok` — tool ran successfully and the `data` field carries substantive results.
- `honest_gap` — tool ran successfully and found no relevant data. Veto's anti-bias signal: "no historical failure modes found for X" is a finding, not a failure. Empty `data` is intentional.
- `error` — tool actually failed. Structured `error: { code, message }` carries the cause. Codes: `external_api_failure`, `rate_limited`, `invalid_input`, `internal_error`.

Once every tool's MCP response carries this discriminator, models can't confabulate infrastructure root causes — they're forced to read the field. The current envelope leaves room for rationalization: `{ data, sources, confidence_note, fallbacks_used }` has no machine-readable success/gap/error signal, so models pattern-match unexpected shapes (empty arrays, populated `fallbacks_used`, absent expected sub-fields) into plausible-sounding stories.

## Why this matters

Three field reports today, all the same anti-pattern:

| # | Model's claim | Actual cause | Phase that fixed it |
|---|---|---|---|
| 1 | "Schema isn't publicly documented, requires reverse-engineering from errors alone" | `resource://report-schema` was never registered | Phase 08 |
| 2 | "The Veto MCP server is timing out" | Server responded in 291ms; arg name was `idea` instead of `idea_description` | commit `32987c0` |
| 3 | "Two tools can't connect to their local database — directory doesn't exist" | Neither tool touches SQLite; `get_category_failure_modes` returned `failure_modes: []` + an honest-gap verdict; model read the empty array as an error and confabulated a DB root cause | This phase |

Each previous fix added prompt guardrails — useful, but advisory. Prompts are read by an LLM that's free to ignore them. **Structural envelope changes are not.** A well-typed JSON envelope with a status discriminator removes the room for rationalization at the parse layer, not the prose layer.

Veto's whole value prop is "make confirmation bias structurally impossible" (spec §1). The rationalization pattern is exactly that bias, applied to the framework's own output. If we don't close it structurally, the anti-bias guarantee leaks every time a tool returns an unexpected shape.

## Architectural decisions (locked with Aljosa 2026-06-15)

1. **Discriminator name + values are fixed:** `status: 'ok' | 'honest_gap' | 'error'`. Three values, no more, no fewer. `'ok'` is the success case, `'honest_gap'` is Veto-specific (the anti-bias gap surface), `'error'` is failure. Models can branch on one of three known strings rather than inferring from envelope shape.

2. **Additive, not replacing.** Existing `data`, `sources`, `confidence_note`, `fallbacks_used` stay. Adding `status` (always present) + `error?` (only on `status: 'error'`). Backwards-compatible: any existing consumer that doesn't read `status` keeps working. New consumers read the discriminator first.

3. **Helpers, not raw object literals.** `src/lib/envelope.ts` exports `okResult`, `honestGapResult`, `errorResult`. All tool returns route through these. Eliminates drift; future tools can't accidentally forget the status field.

4. **Error codes are an enum, not free-form strings.** `external_api_failure`, `rate_limited`, `invalid_input`, `internal_error`. Tight surface so models can write deterministic branches. Open-ended `message` field carries the human-readable detail.

5. **`fallbacks_used` is independent of `status`.** A tool can return `status: 'ok'` with `fallbacks_used: ['serper_global_cap']` (real Veto behavior — Serper rate-limited but the tool delivered useful data from other sources). The status field reports what the model should DO with the response; `fallbacks_used` is provenance.

6. **INVIOLATE overrides — narrow and explicit.**
   - `src/prompts/validate-idea.ts` — third narrow override in two phases. Same pattern. Adding one paragraph in Step 1 instructing the model to read `status` as source of truth and naming the anti-rationalization rule explicitly.
   - `src/tools/finalize-validation-report.ts` — wrap the outer MCP `content[0].text` payload in the status envelope so the tool surface is uniform across all 13. Pipeline (parse → schema → structural → verdict → render) is untouched. `expected_skeleton` + `hints[]` from Phase 08 carry forward unchanged.
   - Other 12 tools in `src/tools/` are NOT INVIOLATE — direct modification is fine.

7. **`assert-fomi-run.ts` regression gate.** Adding a `status` field to the raw tool response envelope does NOT change the rendered markdown artifact. The renderer reads `ValidationReport` (constructed by the LLM from tool envelopes), not the envelopes themselves. The FOMI artifact at `.planning/validation-runs/03-fomi-via-https.md` should remain byte-identical, and `assert-fomi-run` should stay 6/6 across every commit. If any commit breaks it, that's a sign the wrapping leaked into the rendered artifact — escalate.

## Out of scope

- **Renaming `idea_description` to `idea`.** Already addressed by commit `32987c0` (prompt convention guidance). If field reports show the rename is still needed, do it as a separate small phase.
- **Aliasing tool argument names.** Same — already covered.
- **Auto-retry on `error` status.** Server doesn't retry. The model decides what to do based on the code (e.g. `rate_limited` → wait, `external_api_failure` → log and continue, `internal_error` → surface to user).
- **Auto-fallback on `honest_gap`.** Server doesn't search again. Empty data is itself the finding — that's the whole point of the discriminator.
- **Restructuring the `data` field per tool.** Out of scope; each tool's data shape stays as-is.

## Success criteria

| Criterion | Verified by |
|---|---|
| `ToolResult<T>` type carries `status: 'ok' \| 'honest_gap' \| 'error'` + optional `error: { code, message }` | T02 |
| `src/lib/envelope.ts` exports `okResult`, `honestGapResult`, `errorResult` constructors + `TOOL_ERROR_CODES` enum | T03 |
| Every gate tool routes ALL return paths through the envelope helpers (no raw object literals returning `{ data, sources, ... }` without `status`) | T04 |
| `finalize_validation_report` returns the same status envelope as the gate tools | T05 |
| Each tool's `description` field documents the envelope contract (visible via MCP `tools/list`) | T06 |
| `validate_idea` prompt has a status-discriminator paragraph that names the anti-rationalization rule | T07 |
| `src/lib/envelope.test.ts` covers all three helpers | T08 |
| At least one envelope-shape test asserts every tool returns a parsed envelope with a valid `status` string | T08 |
| All previously-passing tests still pass (270+) | T09 |
| `assert-fomi-run` still exits 0 with 6/6 PASS | T09 |
| `npm run smoke:http` still 13/13 tools | T09 |
| Production `/health` reports `status: ok` after deploy | T10 |
| Direct prod tool call returns an envelope with the new `status` field | T10 |

## INVIOLATE files for this phase

- **Phase 01 INVIOLATE remain untouched except as noted:**
  - `src/validation/` (entire directory) — fully untouched.
  - `src/lib/bias.ts` — fully untouched.
  - `src/prompts/validate-idea.ts` — narrow override (T07): one paragraph in Step 1.
  - `src/tools/finalize-validation-report.ts` — narrow override (T05): outer MCP `content[0].text` wrap only; pipeline untouched.
- **Phase 08 surfaces:** `src/resources/report-schema.ts`, `src/tools/finalize-validation-report.ts` (failure envelope) carry forward unchanged. The status envelope wraps the existing `FailureResult` shape, doesn't replace it.

If a task description seems to require touching files outside this allowlist, that's a sign the plan has a bug — escalate.
