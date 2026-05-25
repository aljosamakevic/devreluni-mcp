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

describe('renderReport', () => {
  it('renders the synthetic valid report deterministically', () => {
    const markdown = renderReport(validReport);
    expect(markdown).toMatchSnapshot();
  });
});
