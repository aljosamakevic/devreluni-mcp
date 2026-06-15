# Phase 08 — Finalize-Report DX: report-schema resource + enriched failure envelope

## Phase goal

Stop calling models from skipping `finalize_validation_report` because the schema is undiscoverable in practice. Ship two changes that close the loop without touching the validator pipeline:

1. **Wire up the resource the prompt already promises.** `src/prompts/validate-idea.ts:138` instructs the LLM to "load `resource://report-schema` for the live JSON schema." That URI was never registered. Register it. Body: JSON Schema derived from `ValidationReportSchema` via `zod-to-json-schema`, plus a minimal-valid skeleton, plus an abbreviated worked example. Make the prompt's load step mandatory rather than optional.

2. **Enrich the failure envelope.** On `validation_failed`, return the existing Zod issues PLUS a `expected_skeleton` field carrying the minimal-valid skeleton, plus per-issue `hint` strings that name the path and the allowed values (so the retry attempt has actionable feedback). Failure branch only; success branch and pipeline untouched.

## Why this matters

Field report (2026-06-15) from a real `validate_idea` invocation:

> The schema is very opinionated and I'm hitting deep nested type mismatches. The `finalize_validation_report` schema expects a very specific internal format that isn't publicly documented. Looks like this is a known limitation — the MCP's report schema isn't exposed and requires reverse-engineering from errors alone. Let me skip the finalize step and give you the complete analysis directly, which is actually more useful anyway.

This is the **exact** failure mode Veto is built to prevent — confirmation bias around the framework's own output. When the LLM rationalizes skipping the validator, the three Validation Checks never fire, the verdict-validator never overrides, and the user gets an unvalidated synthesis that looks polished but has no anti-bias guarantees.

Root cause: the schema **is** documented (`src/validation/schema.ts` + `types.ts`), but the LLM cannot read filesystem paths. The MCP resource that was supposed to carry the schema to the wire (`resource://report-schema`) was referenced in the prompt and never registered. Plus the tool's MCP-advertised `inputSchema` is `{ report_json: z.string() }` — discovery via `tools/list` returns "send any string." So the LLM has no contract at construction time and no actionable feedback at retry time, hits the retry-policy ceiling at 2 attempts, and rationalizes the skip.

## Architectural decisions (locked with Aljosa 2026-06-15)

1. **Scope: A + C from the 2026-06-15 diagnosis, not B.**
   - **A**: Register `resource://report-schema` returning JSON Schema + skeleton + example. Outside Phase 01 INVIOLATE files.
   - **C**: Enrich the failure envelope of `finalize_validation_report`. **INVIOLATE override** (see decision 2).
   - **B** deferred: restructuring the tool to take a structured `ValidationReport` object instead of a JSON string. Would advertise the full nested schema via MCP `tools/list` at discovery time, but touches the wrapper more invasively and changes the `validate_idea` prompt's output contract. Ship A + C, watch the field for whether the failure mode recurs, then decide on B.

2. **INVIOLATE override for `src/tools/finalize-validation-report.ts`.**
   HANDOFF.md says: "must not be modified by any future work without explicit human review." Aljosa explicitly approved this exception (2026-06-15 conversation: "tackle the above using gsd" after the proposal was laid out). The override is **narrow**:
   - Only the failure-branch payload shape changes (new fields appended to existing failure responses).
   - The pipeline order (parse → schema → structural → verdict → render) is untouched.
   - `src/validation/*` is fully untouched.
   - `parseValidationReport`, `structuralValidate`, `verdictValidate`, `renderReport` are untouched.
   - `scripts/assert-fomi-run.ts` must still exit 0 with 6/6 PASS after every commit in this phase.
   The success-branch envelope is unchanged so existing callers/tests stay green.

3. **Resource body format: markdown with fenced JSON blocks.**
   Resources are returned as `text/markdown` already (matches the other three). The body has three labeled sections:
   ```
   # ValidationReport — schema, skeleton, example
   ## JSON Schema
   ```json
   { ...zod-to-json-schema output... }
   ```
   ## Minimal-valid skeleton
   ```json
   { ...smallest passing report... }
   ```
   ## Worked example (truncated)
   ```json
   { ...synthetic-report.ts trimmed... }
   ```
   ```
   Markdown is what LLMs parse most reliably; fenced JSON blocks are extractable with a single regex if the LLM wants to programmatically reuse the skeleton.

4. **Use `zod-to-json-schema` (existing ecosystem package).** Don't hand-roll. The package is widely used, ~30k LOC of edge-case handling for nested z.union, z.discriminatedUnion, refinements, z.literal arrays, etc. Pin to a stable major.

5. **Failure-envelope additions (additive, not replacing).**
   Existing `FailureResult` keeps `status`, `stage`, `issues`, `partial_report`. New fields:
   - `expected_skeleton: object` — the minimal-valid skeleton (same JSON the resource serves). Always present on `stage: 'schema' | 'structural'`.
   - `hints: string[]` — one per `issues[i]`, in matching order. Each hint names the path (`gates[2].dok1_facts[3].tier`) and the constraint (`expected one of S, A, B, C, D; got "high"`). Stage `parse` (invalid JSON) gets a single hint pointing at the JSON error location if available.

6. **Prompt rewording — active, not passive.**
   Current line 138: "You may also load `resource://report-schema` for the live JSON schema."
   New: before the JSON-construction guidance, insert a mandatory step: "Before constructing the ValidationReport JSON, load `resource://report-schema`. The resource returns the live JSON Schema, a minimal-valid skeleton, and a worked example. Construct your JSON to match the schema exactly."

## Out of scope

- **Restructuring tool input shape (B).** Deferred per decision 1.
- **Auto-fix-on-failure.** Server does NOT mutate the LLM's JSON to make it pass — the LLM retries.
- **Schema relaxation.** The validator is INVIOLATE. We do not loosen any rule to make construction easier. We only make the existing rules discoverable.
- **`zod-to-json-schema` build-time pre-generation.** Generate on each resource read. Cost is microseconds; pre-generation adds a build step and a stale-artifact risk.

## Success criteria

| Criterion | Verified by |
|---|---|
| `resource://report-schema` returns markdown containing all three sections | T03 + T07 |
| JSON Schema section parses as valid JSON Schema | T07 |
| Minimal-valid skeleton round-trips through `parseValidationReport` without issues | T07 |
| `finalize_validation_report` with deliberately-broken payload returns enriched envelope: `expected_skeleton` present + `hints[]` non-empty | T07 |
| Hint text names the offending path AND the constraint | T07 |
| `validate_idea` prompt instructs the LLM to load the resource before constructing JSON | T06 (visual inspection of prompt text) |
| All 260 existing tests still pass | T08 |
| `scripts/assert-fomi-run.ts` still exits 0 with 6/6 PASS | T08 |
| `npm run smoke:http` still 13/13 tools | T08 |
| `html-validate public/index.html` still clean | T08 |
| Production `/health` reports `status: ok` after deploy | T09 |

## INVIOLATE files for this phase

The override in decision 2 covers `src/tools/finalize-validation-report.ts` only. The following Phase 01 files remain INVIOLATE in this phase and must NOT be modified by any task:
- `src/validation/` (entire directory)
- `src/lib/bias.ts`
- `src/prompts/validate-idea.ts` — **partial override**: this phase modifies only the schema-resource-loading instruction in Step 7. No other text changes.

If a task description seems to require touching files outside this allowlist, that's a sign the plan has a bug — escalate.
