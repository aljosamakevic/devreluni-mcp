// T-V09 — Snapshot test for renderReport().
//
// Per CONTEXT.md "R5" / CONCERNS.md L1: only the deterministic renderer is
// snapshotted; LLM outputs are never snapshotted. renderReport() is a pure
// function so byte-stable output is the contract — any drift in section
// ordering, headings, or the canonical SPIKY_POV_BLANK_TEMPLATE constant
// breaks this snapshot loudly.

import { describe, it, expect } from 'vitest';
import { renderReport } from './renderer.js';
import { validReport } from './__fixtures__/synthetic-report.js';
import type { ValidationReport } from './types.js';

describe('renderReport', () => {
  it('renders the synthetic valid report deterministically', () => {
    const markdown = renderReport(validReport);
    expect(markdown).toMatchSnapshot();
  });

  // Phase 10 — killshots must never be silently dropped.
  function withKillshots(overall: ValidationReport['verdict']['overall']): ValidationReport {
    const r = JSON.parse(JSON.stringify(validReport)) as ValidationReport;
    r.verdict.overall = overall;
    r.verdict.killshots = [
      { reason: 'Apple owns the surface and the API.', cited_source_urls: ['https://developer.apple.com/'] },
    ];
    return r;
  }

  it('renders killshots under "Killshot reasons" on a NO-GO verdict', () => {
    const md = renderReport(withKillshots('NO-GO'));
    expect(md).toContain('### Killshot reasons');
    expect(md).not.toContain('### Key risks flagged');
    expect(md).toContain('Apple owns the surface and the API.');
  });

  it('surfaces killshots under "Key risks flagged" when the verdict is softened', () => {
    const md = renderReport(withKillshots('CONDITIONAL GO'));
    expect(md).toContain('### Key risks flagged (not verdict-determining)');
    expect(md).not.toContain('### Killshot reasons');
    // The reasoning must NOT vanish from the report.
    expect(md).toContain('Apple owns the surface and the API.');
  });
});
