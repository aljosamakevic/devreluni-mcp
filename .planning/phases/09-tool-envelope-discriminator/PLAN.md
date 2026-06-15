# Phase 09 — Tool envelope status discriminator

> **Author:** Claude (Opus 4.7 [1M]) + Aljosa, 2026-06-15
> **CONTEXT basis:** `.planning/phases/09-tool-envelope-discriminator/CONTEXT.md`
> **Style template:** `.planning/phases/08-finalize-dx/PLAN.md`

---

## Phase Goal

Add a machine-readable `status` discriminator to every tool's response envelope so models stop confabulating infrastructure root causes (DB errors, timeouts, undocumented schemas) when they see unexpected envelope shapes.

**Inviolate constraints:**
- `assert-fomi-run` exits 0 with 6/6 PASS after every commit.
- 13 tools + 5 prompts + 4 resources stay registered.
- `src/validation/*`, `src/lib/bias.ts` fully untouched.
- `src/prompts/validate-idea.ts` — one new paragraph in Step 1 only.
- `src/tools/finalize-validation-report.ts` — outer MCP response wrap only; pipeline untouched.

---

## Goal-Backward Verification

| Success criterion | Producing task(s) |
|---|---|
| `ToolResult<T>` type carries status discriminator | **T02** |
| envelope.ts exports helpers + error codes | **T03** |
| All 12 gate tools route through helpers | **T04** |
| finalize_validation_report wraps response uniformly | **T05** |
| Tool descriptions advertise envelope contract | **T06** |
| Prompt has anti-rationalization paragraph | **T07** |
| Envelope helpers covered by tests | **T08** |
| Every tool returns a valid `status` string | **T08** |
| 270+ tests still pass | **T09** |
| assert-fomi-run 6/6 | **T09** |
| smoke:http 13/13 | **T09** |
| Prod /health ok post-deploy | **T10** |
| Direct prod tool call returns `status` field | **T10** |

---

## Tasks (atomic commits)

### T01 — Phase scaffold _(this CONTEXT.md + PLAN.md)_
**Commit subject:** `docs(09): scaffold tool envelope discriminator phase`

### T02 — Extend `ToolResult<T>`
**Files touched:** `src/types.ts`
**Action:** Add `status: 'ok' | 'honest_gap' | 'error'` + optional `error?: { code: ToolErrorCode; message: string }`. Define `ToolErrorCode` union: `'external_api_failure' | 'rate_limited' | 'invalid_input' | 'internal_error'`. Existing tools become type-errors (`status` is required) until T04 migrates them.
**Commit subject:** `feat(types): add status discriminator to ToolResult envelope`

### T03 — Build envelope helpers
**Files touched:** new `src/lib/envelope.ts`
**Action:** Export three thin constructors:
```ts
okResult<T>(data, sources, confidence_note, fallbacks_used = []): ToolResult<T>
honestGapResult<T>(data, sources, confidence_note, fallbacks_used = []): ToolResult<T>
errorResult(code: ToolErrorCode, message, sources = [], fallbacks_used = []): ToolResult<null>
```
Plus `TOOL_ERROR_CODES` as a `const` object for ergonomic use at call sites. JSDoc on each helper names the semantics so tool authors don't pick the wrong one.
**Commit subject:** `feat(envelope): okResult / honestGapResult / errorResult helpers`

### T04 — Migrate 12 gate tools
**Files touched:** all 12 tools in `src/tools/` excluding `finalize-validation-report.ts`.
**Action:** Replace every `return { data, sources, confidence_note, fallbacks_used }` literal with the appropriate helper:
- Substantive data → `okResult(...)`
- Empty arrays / "no results found" verdicts (Veto's deliberate anti-bias signal) → `honestGapResult(...)`
- Caught external API failure currently returning fallback data → keep returning data but as `okResult` with `fallbacks_used` populated (this IS a successful degraded run, not an error); only ACTUAL aborted-tool failures become `errorResult`
- New Zod-validated input rejection → `errorResult(TOOL_ERROR_CODES.invalid_input, ...)` (the MCP layer already catches Zod issues, but tools that do additional validation can emit this)

May commit per-tool or batch by gate group; whichever keeps diffs reviewable. Test the captured FOMI artifact remains byte-identical after each commit (tool envelope changes are invisible to the renderer; if FOMI drifts, a tool wrapped data wrong).
**Commit subject (per group):** `feat(tools): wrap <gate-N> tools in status envelope`

### T05 — Wrap finalize_validation_report's MCP response
**Files touched:** `src/tools/finalize-validation-report.ts` _(INVIOLATE narrow override)_
**Action:** Currently the tool's MCP handler returns `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`. Wrap the JSON text in a status envelope: `status: 'ok'` when `result.status === 'ok'`, `status: 'error'` (code: `invalid_input`) when `result.status === 'validation_failed'`. The `result` object itself (with `markdown`, `issues`, `expected_skeleton`, etc.) goes inside `data`. Pipeline + Phase 08 enriched failure envelope unchanged.
**Commit subject:** `feat(finalize): wrap MCP response in status envelope for uniformity`

### T06 — Tool descriptions advertise envelope
**Files touched:** all 13 tools' `description` field in their `server.registerTool(...)` call.
**Action:** Append one sentence: `"Response envelope: { status: 'ok' | 'honest_gap' | 'error', data, sources, confidence_note, fallbacks_used, error? }. status='honest_gap' means the run succeeded and the absence of data is the finding — treat as evidence gap, not failure."` Idempotent; MCP `tools/list` now carries this contract at discovery time.
**Commit subject:** `feat(tools): advertise envelope contract in tool descriptions`

### T07 — validate_idea anti-rationalization paragraph
**Files touched:** `src/prompts/validate-idea.ts` _(INVIOLATE narrow override)_
**Action:** Insert a paragraph in Step 1 (right after the TOOL CALLING CONVENTION paragraph from commit `32987c0`):
```
READ THE STATUS FIELD on every tool response.
- status: 'ok' — use the data.
- status: 'honest_gap' — the tool ran successfully but found no substantive data. The absence IS the finding. Log it in methodology_notes.tool_calls with succeeded: true and a brief failure_note describing the gap, then continue. Do NOT call the tool again, do NOT call a different tool to "verify", do NOT skip the gate.
- status: 'error' — the tool actually failed. Read error.code (external_api_failure / rate_limited / invalid_input / internal_error) to know what happened. Log it and continue with the remaining gates. NEVER invent infrastructure root causes (no "DB error", no "server timing out", no "schema is undocumented") — the error.code is the source of truth. If the model is unable to identify a code, the response is still authoritative.
```
**Commit subject:** `fix(prompt): require validate_idea to read status field, forbid infra-error confabulation`

### T08 — Tests
**Files touched:** new `src/lib/envelope.test.ts`, new `src/tools/_envelope-shape.test.ts`
**Action:**
`envelope.test.ts`:
- `okResult(...)` returns `{ status: 'ok', data, sources, confidence_note, fallbacks_used }` with no `error` field.
- `honestGapResult(...)` returns `{ status: 'honest_gap', ... }` with no `error` field. `data` is passed through verbatim (empty arrays OK).
- `errorResult(code, message)` returns `{ status: 'error', data: null, sources: [], confidence_note: '', fallbacks_used: [], error: { code, message } }`.

`_envelope-shape.test.ts`:
- Import each tool's exported register function (or its inner pure function if exported); fire each with a minimal arg; assert the response JSON has a `status` field that is one of `'ok' | 'honest_gap' | 'error'`. Single test loop over the list of tools. Future tool additions that forget the envelope fail this test.
**Commit subject:** `test(09): envelope helpers + per-tool status-field regression`

### T09 — Full regression sweep
**Action:** Run sequentially, fix at root on any failure:
```bash
npm run build
npm test                          # expect ≥ 275 pass
npx tsx scripts/assert-fomi-run.ts # expect 6/6 PASS
npm run smoke:http                # expect 13/13 tools, SMOKE OK
npx --yes html-validate@9 public/index.html
( node build/index.js > /tmp/v-out.log 2> /tmp/v-err.log & PID=$!; sleep 1; kill $PID; wait )
test "$(wc -c < /tmp/v-out.log)" -eq 0   # stdio stdout still clean
```
**Verification:** all six gates green.

### T10 — Deploy
**Action:** Push to `origin/main`. Watch CI. Verify `curl -sS https://getvetoed.com/health` returns ok with fresh uptime. Smoke-test one gate tool via Streamable HTTP (full session: initialize → initialized → tools/call) and confirm the response JSON includes `"status": "ok"`.
**Verification:** prod confirms new envelope on the wire.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Envelope change leaks into rendered FOMI artifact (assert-fomi-run breaks) | Low | Renderer reads `ValidationReport`, not tool envelopes. T09 runs assert-fomi-run after every commit. |
| `honest_gap` vs `ok` classification is subjective — same tool returns `ok` one day and `honest_gap` the next | Medium | Helper JSDoc names the semantics ("substantive results" vs "ran cleanly but found nothing relevant"). T08's per-tool regression catches drift. If field reports show classification inconsistency, codify per-tool rules in CONCERNS.md. |
| Models trained pre-Phase-09 still ignore the status field | Medium | Tool description + prompt paragraph cover both LLM discovery channels. If field reports show models still confabulate, escalate to a stronger structural change (e.g. discriminated union types in the MCP response schema so the model must pattern-match). |
| Future tool added without going through helpers, forgets status | Low | T08's `_envelope-shape.test.ts` is a structural regression; CI fails on missing field. |

---

## Out-of-scope items

- **Renaming `idea_description` → `idea`.** Already addressed by commit `32987c0`.
- **Auto-retry on `error`.** Server-side magic; out of scope.
- **Auto-fallback on `honest_gap`.** Empty data IS the finding; out of scope.
- **Restructuring per-tool `data` shapes.** Out of scope.
