/**
 * Phase 10 — verdict-validator coverage, focused on the existential-gate veto
 * (Gate 3 Platform / Moat Risk FAIL → NO-GO). Complements the in-file tsx
 * self-check block with proper vitest cases that run in CI.
 */

import { describe, it, expect } from 'vitest';
import { verdictValidate } from './verdict-validator.js';
import { validReport } from './__fixtures__/synthetic-report.js';
import type { ValidationReport, GateStatus } from './types.js';

function clone(): ValidationReport {
  return JSON.parse(JSON.stringify(validReport)) as ValidationReport;
}

function setGate(r: ValidationReport, gateNumber: number, status: GateStatus): void {
  const g = r.gates.find((x) => x.gate === gateNumber)!;
  g.status = status;
  g.dok4_verdict.status = status;
}

describe('existential-gate veto (Gate 3 FAIL → NO-GO)', () => {
  it('a lone Gate 3 FAIL vetoes CONDITIONAL GO up to NO-GO', () => {
    const r = clone();
    setGate(r, 3, 'FAIL'); // 1 total fail → fail-2 math says CONDITIONAL GO
    const { adjusted_report, issues } = verdictValidate(r);
    expect(adjusted_report.verdict.overall).toBe('NO-GO');
    expect(issues.some((i) => i.code === 'existential_gate_veto')).toBe(true);
  });

  it('a lone NON-existential FAIL (Gate 1) stays CONDITIONAL GO — no veto', () => {
    const r = clone();
    setGate(r, 1, 'FAIL');
    const { adjusted_report, issues } = verdictValidate(r);
    expect(adjusted_report.verdict.overall).toBe('CONDITIONAL GO');
    expect(issues.some((i) => i.code === 'existential_gate_veto')).toBe(false);
  });

  it('a Fundamental validation-check still overrides the veto to INCONCLUSIVE', () => {
    const r = clone();
    setGate(r, 3, 'FAIL');
    r.validation_checks[1]!.outcome = 'Fundamental';
    const { adjusted_report, issues } = verdictValidate(r);
    expect(adjusted_report.verdict.overall).toBe('INCONCLUSIVE');
    // The veto still fired (it ran before the matrix) but the matrix superseded it.
    expect(issues.some((i) => i.code === 'existential_gate_veto')).toBe(true);
    expect(issues.some((i) => i.code === 'validation_check_fundamental')).toBe(true);
  });

  it('two FAILs including Gate 3 → NO-GO via count, no double-veto issue needed', () => {
    const r = clone();
    setGate(r, 1, 'FAIL');
    setGate(r, 3, 'FAIL'); // already NO-GO by count
    const { adjusted_report, issues } = verdictValidate(r);
    expect(adjusted_report.verdict.overall).toBe('NO-GO');
    // Count already produced NO-GO, so the veto is a no-op (no issue pushed).
    expect(issues.some((i) => i.code === 'existential_gate_veto')).toBe(false);
  });

  it('all gates PASS → GO, veto dormant', () => {
    const r = clone();
    const { adjusted_report } = verdictValidate(r);
    expect(adjusted_report.verdict.overall).toBe('GO');
  });
});
