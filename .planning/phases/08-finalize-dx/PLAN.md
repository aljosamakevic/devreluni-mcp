# Phase 08 — Finalize-Report DX

> **Author:** Claude (Opus 4.7 [1M]) + Aljosa, 2026-06-15
> **CONTEXT basis:** `.planning/phases/08-finalize-dx/CONTEXT.md`
> **Spec basis:** `.planning/spec/build-spec-v1.0.md` §1 (anti-bias non-regression), §11 DoD (`assert-fomi-run` 6/6)
> **Style template:** `.planning/phases/03-multitenant-https/PLAN.md`

---

## Phase Goal

Ship `resource://report-schema` plus an enriched failure envelope for `finalize_validation_report` so calling LLMs have a discoverable contract at construction time and actionable feedback at retry time. The two changes together eliminate the failure mode where models rationalize skipping the validator after hitting the retry-policy ceiling.

**Inviolate constraints (carried from Phase 01):**
- `scripts/assert-fomi-run.ts` must exit 0 with 6/6 PASS after every commit in this phase.
- 13 tools + 5 prompts stay registered. This phase adds 1 resource (4 total: source-tier-bias, tool-to-gate-map, evaluation-lens-matrix, report-schema).
- `src/validation/*`, `src/lib/bias.ts` not touched.
- `src/tools/finalize-validation-report.ts`: failure-branch payload extended only. Pipeline untouched.
- `src/prompts/validate-idea.ts`: Step 7 schema-loading instruction rewritten only. No other text changes.

---

## Goal-Backward Verification

| Success criterion | Producing task(s) |
|---|---|
| `resource://report-schema` returns markdown with JSON Schema + skeleton + example | **T02** (module) + **T03** (registration) + **T07** (test) |
| JSON Schema section parses as valid JSON Schema | **T02** (zod-to-json-schema output) + **T07** (test) |
| Minimal-valid skeleton round-trips through `parseValidationReport` | **T02** (skeleton authored against schema) + **T07** (test) |
| Enriched failure envelope: `expected_skeleton` + `hints[]` non-empty | **T05** (envelope) + **T07** (test) |
| `validate_idea` prompt instructs load-before-construct | **T06** |
| All 260 existing tests pass | **T07** + **T08** |
| `assert-fomi-run` 6/6 PASS | **T08** |
| `smoke:http` 13/13 | **T08** |
| `html-validate` clean | **T08** |
| Production `/health` ok post-deploy | **T09** |

---

## Tasks (atomic commits)

### T01 — Add `zod-to-json-schema` dependency
**Files touched:** `package.json`, `package-lock.json`
**Action:** `npm install zod-to-json-schema@^3` (pin major; this package is stable + actively maintained).
**Commit subject:** `chore(deps): add zod-to-json-schema for report-schema resource`
**Verification:** `npm ls zod-to-json-schema` shows the install. `tsc` still passes.

### T02 — Build `src/resources/report-schema.ts`
**Files touched:** new `src/resources/report-schema.ts`.
**Action:** Module exports `buildReportSchemaResource(): string` — pure function, no side effects. Internals:
1. `import { zodToJsonSchema } from 'zod-to-json-schema'`.
2. `import { ValidationReportSchema } from '../validation/schema.js'`.
3. Convert: `const jsonSchema = zodToJsonSchema(ValidationReportSchema, { name: 'ValidationReport', $refStrategy: 'none' })` — flatten refs so the LLM sees inlined enums and nested shapes.
4. Author a `MINIMAL_VALID_SKELETON: ValidationReport` literal — the smallest passing report. 5 gates with one DOK 1 fact each, 3 validation checks with `No issues`, 3 test cards, canonical blank Spiky POV, populated source_appendix + methodology_notes.
5. Reuse `synthetic-report.ts` fixture for the worked example. Truncate long string fields to keep the resource under 8 KB.
6. Concatenate into markdown:
   ```
   # ValidationReport — schema, skeleton, example
   _Generated from ValidationReportSchema. The schema is authoritative; if this document drifts, trust the JSON Schema below._
   ## JSON Schema
   ```json
   { ...jsonSchema... }
   ```
   ## Minimal-valid skeleton
   ```json
   { ...MINIMAL_VALID_SKELETON... }
   ```
   ## Worked example (truncated)
   ```json
   { ...synthetic-report truncated... }
   ```
   ```
**Commit subject:** `feat(resources): build report-schema resource (JSON Schema + skeleton + example)`
**Verification:** T07 covers behavior.

### T03 — Register `resource://report-schema` in `src/index.ts`
**Files touched:** `src/index.ts`
**Action:** Add a 4th `server.resource('report-schema', 'resource://report-schema', async () => ({ ... }))` block alongside the existing three. Body returned by `buildReportSchemaResource()`. mimeType: `text/markdown`. Update the `console.error('Resources: ...')` banner line to include `report-schema`.
**Commit subject:** `feat(server): register resource://report-schema so prompts can discover the schema`
**Verification:** T07 calls the resource handler end-to-end.

### T04 — Export `MINIMAL_VALID_SKELETON` from the resource module
**Files touched:** `src/resources/report-schema.ts`
**Action:** Export the skeleton constant so T05 (envelope enrichment) and T07 (tests) can import it without duplicating the literal.
**Note:** This may collapse into T02 if cleaner; keep separate only if T02's commit is already large.
**Commit subject:** _(may roll into T02)_

### T05 — Enrich `finalize_validation_report` failure envelope
**Files touched:** `src/tools/finalize-validation-report.ts` _(INVIOLATE override per CONTEXT.md decision 2)_
**Action:** Failure-branch only. Extend `FailureResult`:
```ts
interface FailureResult {
  status: 'validation_failed';
  stage: FailStage;
  issues: ParseFailureIssue[] | ZodIssue[] | ValidationIssue[];
  partial_report?: ValidationReport;
  expected_skeleton: ValidationReport;       // NEW
  hints: string[];                           // NEW (1 per issue, matching order)
}
```
Build `hints` from the issues array with a switch on stage:
- `parse`: single hint pointing at the JSON parse error message + position if available.
- `schema`: per ZodIssue, format as ``${issue.path.join('.')} — ${formatZodIssue(issue)}`` (e.g. `gates.2.dok1_facts.3.tier — expected one of "S","A","B","C","D"; got "high"`).
- `structural`: per ValidationIssue, format as `[${issue.code}] ${issue.message}` with the path field if present.
The pipeline order (`parse → schema → structural → verdict → render`) is unchanged. Success branch is unchanged. No mutation of `issues[]` itself.
**Commit subject:** `feat(finalize): enrich validation_failed envelope with expected_skeleton + hints`
**Verification:** T07 covers behavior. assert-fomi-run still 6/6 (success path unaffected).

### T06 — Update `validate_idea` prompt: load resource before constructing JSON
**Files touched:** `src/prompts/validate-idea.ts` _(narrow INVIOLATE override per CONTEXT.md final section)_
**Action:** Replace the current passive line ("You may also load `resource://report-schema` for the live JSON schema.") with an active, mandatory step inserted BEFORE the OUTPUT CONTRACT block. New wording:
```
Before constructing the ValidationReport JSON, load `resource://report-schema`.
The resource returns the live JSON Schema, a minimal-valid skeleton, and a
worked example. Construct your JSON to match the schema exactly. If
`finalize_validation_report` returns `validation_failed`, the response
includes `expected_skeleton` and `hints[]` — use them to correct your JSON
on the retry attempt.
```
No other prompt text changes.
**Commit subject:** `feat(prompt): make report-schema load mandatory before JSON construction`
**Verification:** prompt-count.test.ts unchanged (still 5 prompts). assert-fomi-run still 6/6.

### T07 — Tests
**Files touched:** new `src/resources/report-schema.test.ts`, new `src/tools/finalize-validation-report.test.ts`
**Action:**
`report-schema.test.ts`:
- `buildReportSchemaResource()` returns a string containing `## JSON Schema`, `## Minimal-valid skeleton`, `## Worked example`.
- Extracts the JSON Schema fenced block and `JSON.parse`s it without throwing; top-level keys include `$schema` or `type: 'object'`.
- Extracts the skeleton fenced block, JSON.parses it, hands it to `parseValidationReport` — expects `{ ok: true }`.
- Hands the skeleton to `finalizeValidationReport` (call the pure function) and expects `{ status: 'ok' }` (or surfaces verdict-validator adjustments without rendering blocked).

`finalize-validation-report.test.ts`:
- Stage `parse`: pass `"not json"` → `validation_failed`, `stage: 'parse'`, `hints.length === 1`, `expected_skeleton` present.
- Stage `schema`: pass `JSON.stringify({})` → `validation_failed`, `stage: 'schema'`, `hints.length >= 1`, at least one hint contains a path token (`header`, `verdict`, `gates`, etc.), `expected_skeleton` present and parses cleanly.
- Stage `schema` with one bad enum: take MINIMAL_VALID_SKELETON, set `gates[0].dok1_facts[0].tier = 'high'`, stringify, pass through → hint mentions `tier` and the allowed values `S, A, B, C, D`.
- Success path unchanged: pass JSON.stringify(MINIMAL_VALID_SKELETON) → `{ status: 'ok' }`.

**Commit subject:** `test(finalize-dx): cover report-schema resource + enriched failure envelope`
**Verification:** vitest passes; total count ≥ 264 (260 existing + ~4 new).

### T08 — Full regression sweep
**Action:** Run sequentially, fix at root on any failure:
```bash
npm run build
npm test                          # expect ≥ 264 pass
npx tsx scripts/assert-fomi-run.ts # expect 6/6 PASS
npm run smoke:http                # expect 13/13 tools, SMOKE OK
npx --yes html-validate@9 public/index.html  # expect clean
```
Boot the stdio binary once and confirm `report-schema` appears in the resources banner on stderr.
**Commit subject:** _no commit; this task validates the prior commits._
**Verification:** all five gates green.

### T09 — Deploy
**Action:** Push to `origin/main`. CI workflow `deploy.yml` runs tests + `flyctl deploy --remote-only`. Watch the run with `gh run watch <id> --exit-status`. Verify `curl -sS https://getvetoed.com/health` returns `status: ok`, `db_ok: true`, `last_error_at: null`, fresh `uptime_s`.
**Verification:** prod `/health` confirms deploy landed.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `zod-to-json-schema` produces output a model can't parse (too many `$ref`s, ambiguous unions) | Low | Use `{ $refStrategy: 'none' }` to flatten refs. Test extracts the JSON and parses it; a runtime regression would fail the test. |
| Minimal-valid skeleton drifts from the validator (passes schema but fails structural-validator) | Medium | T07 explicitly runs the skeleton through `finalizeValidationReport` end-to-end (not just `parseValidationReport`) — catches structural-stage drift. |
| INVIOLATE override creates a precedent | N/A — operational risk, not a code risk | CONTEXT.md decision 2 documents the narrow scope. Future phases follow the same pattern: explicit user approval + narrow file scope + assert-fomi-run preserved. |
| Resource body exceeds MCP client size limits | Low | JSON Schema for ValidationReport is ~6-8 KB; skeleton ~2 KB; worked example truncated. Target total < 12 KB. |
| Prompt change confuses existing successful calls | Low | The instruction is additive ("load this before") + the previous "may also" line is replaced, not deleted. The output contract (emit JSON + call tool) is unchanged. |

---

## Out-of-scope items (deferred to a future phase or never)

- **B (structured tool input).** Restructure `finalize_validation_report` to take a `ValidationReport` object instead of a JSON string. Deferred per CONTEXT decision 1. Revisit if field reports show callers still skip the tool after Phase 08.
- **Auto-retry-with-correction.** Server attempting to repair the LLM's JSON before re-running the pipeline. Out of scope — preserves the anti-bias property that the LLM owns the verdict.
- **Build-time schema generation + on-disk artifact.** Pre-generate the resource body at build time so the read is a file slurp. Microseconds saved; not worth the build-step complexity.
