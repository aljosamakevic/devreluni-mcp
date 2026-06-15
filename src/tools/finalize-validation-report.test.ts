/**
 * Phase 08 T07 — coverage for the enriched validation_failed envelope.
 *
 * Asserts the additive contract from PLAN.md T05:
 *   * Every failure response includes `expected_skeleton` (a valid
 *     ValidationReport the LLM can copy from).
 *   * Every failure response includes `hints[]` (one per issue,
 *     matching order, path-localized).
 *   * Success-branch envelope is unchanged (no spurious fields).
 *
 * Inviolate-adjacent: this test does NOT exercise the validator logic
 * (that's already covered by structural-validator.test.ts and the
 * verdict-validator self-checks). It only exercises the wrapper's
 * failure-branch payload shape.
 */

import { describe, it, expect } from 'vitest';
import { finalizeValidationReport } from './finalize-validation-report.js';
import { MINIMAL_VALID_SKELETON } from '../resources/report-schema.js';

describe('finalizeValidationReport — enriched failure envelope', () => {
  it('parse stage: returns expected_skeleton + 1 hint pointing at JSON syntax', () => {
    const result = finalizeValidationReport('not actually json');
    expect(result.status).toBe('validation_failed');
    if (result.status !== 'validation_failed') return;
    expect(result.stage).toBe('parse');
    expect(result.expected_skeleton).toBeTruthy();
    expect(result.expected_skeleton.header).toBeTruthy();
    expect(result.hints).toHaveLength(1);
    expect(result.hints[0]).toMatch(/JSON parse failed/);
  });

  it('schema stage (empty object): hints[] is non-empty and references top-level fields', () => {
    const result = finalizeValidationReport(JSON.stringify({}));
    expect(result.status).toBe('validation_failed');
    if (result.status !== 'validation_failed') return;
    expect(result.stage).toBe('schema');
    expect(result.hints.length).toBeGreaterThan(0);
    expect(result.expected_skeleton).toBeTruthy();
    // hints should reference at least one of the missing top-level
    // fields (header / verdict / gates / etc).
    const hintsCombined = result.hints.join(' ');
    expect(hintsCombined).toMatch(/header|verdict|gates|validation_checks/);
  });

  it('schema stage (bad enum): hint names the path and the allowed values', () => {
    const broken = JSON.parse(JSON.stringify(MINIMAL_VALID_SKELETON));
    broken.gates[0].dok1_facts[0].source.tier = 'high'; // not in S/A/B/C/D
    const result = finalizeValidationReport(JSON.stringify(broken));
    expect(result.status).toBe('validation_failed');
    if (result.status !== 'validation_failed') return;
    expect(result.stage).toBe('schema');
    // Some hint must mention the path tokens AND at least one allowed value.
    const matched = result.hints.find(
      (h) => /gates\.0\.dok1_facts\.0\.source\.tier/.test(h) && /"S"/.test(h)
    );
    expect(matched, `expected a hint naming the path and allowed values; got: ${JSON.stringify(result.hints)}`).toBeTruthy();
  });

  it('success path: envelope is unchanged (no skeleton/hints on success)', () => {
    const result = finalizeValidationReport(JSON.stringify(MINIMAL_VALID_SKELETON));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.markdown).toBeTruthy();
    expect(result.adjustments_made).toBeInstanceOf(Array);
    // Success envelope keys haven't changed — defensive against
    // accidentally leaking the failure-only fields onto success.
    expect(result).not.toHaveProperty('expected_skeleton');
    expect(result).not.toHaveProperty('hints');
  });
});
