/**
 * Phase 12 — dedicated vitest for the structural validator (previously only a
 * tsx self-check that doesn't run in `vitest run`). Ports the self-check cases
 * and adds the new audit rules: killshot→DOK1 citations (V-H2), gate-3 identity
 * pin (V-M2), and the Source-Quality-Audit depth advisory (V-M4).
 */

import { describe, it, expect } from 'vitest';
import { structuralValidate } from './structural-validator.js';
import {
  validReport,
  reportMissingDok3,
  reportFilledPov,
  reportMissingContradicting,
} from './__fixtures__/synthetic-report.js';
import type { ValidationReport } from './types.js';

function clone(): ValidationReport {
  return JSON.parse(JSON.stringify(validReport)) as ValidationReport;
}
function codes(r: ValidationReport): string[] {
  return structuralValidate(r).map((i) => i.code);
}

describe('structuralValidate — ported self-check', () => {
  it('valid report → zero issues', () => {
    expect(structuralValidate(validReport)).toHaveLength(0);
  });
  it('missing DOK3 → dok3_missing', () => {
    expect(codes(reportMissingDok3)).toContain('dok3_missing');
  });
  it('filled Spiky POV → spiky_pov_violation', () => {
    expect(codes(reportFilledPov)).toContain('spiky_pov_violation');
  });
  it('missing contradicting evidence → contradicting_evidence_missing', () => {
    expect(codes(reportMissingContradicting)).toContain('contradicting_evidence_missing');
  });
});

describe('V-H2 — killshots must cite DOK 1 source URLs', () => {
  it('flags a killshot citing a URL not present in any DOK 1 fact', () => {
    const r = clone();
    r.verdict.overall = 'NO-GO';
    r.verdict.killshots = [{ reason: 'x', cited_source_urls: ['https://not-in-dok1.example/page'] }];
    expect(codes(r)).toContain('killshot_citation_not_in_dok1');
  });
  it('flags a killshot with no citations', () => {
    const r = clone();
    r.verdict.killshots = [{ reason: 'x', cited_source_urls: [] }];
    expect(codes(r)).toContain('killshot_no_citation');
  });
  it('accepts a killshot citing a real DOK 1 URL', () => {
    const r = clone();
    const realUrl = r.gates[0]!.dok1_facts[0]!.source.url;
    r.verdict.killshots = [{ reason: 'x', cited_source_urls: [realUrl] }];
    const cs = codes(r);
    expect(cs).not.toContain('killshot_citation_not_in_dok1');
    expect(cs).not.toContain('killshot_no_citation');
  });
});

describe('V-M2 — gate-3 identity pin', () => {
  it('flags gate 3 mislabeled away from Platform/Moat', () => {
    const r = clone();
    r.gates[2]!.name = 'Why Now';
    expect(codes(r)).toContain('gate3_identity_mismatch');
  });
  it('accepts a canonical platform gate-3 name', () => {
    const r = clone(); // gate 3 = "Platform & Big-Tech Risk"
    expect(codes(r)).not.toContain('gate3_identity_mismatch');
  });
});

describe('V-M4 — Source Quality Audit depth advisory', () => {
  it('emits a minor when the Source Quality Audit has <2 rows', () => {
    const r = clone();
    const sqa = r.validation_checks.find((c) => c.name === 'Source Quality Audit')!;
    sqa.rows = [sqa.rows[0]!];
    expect(codes(r)).toContain('source_quality_audit_shallow');
  });
});
