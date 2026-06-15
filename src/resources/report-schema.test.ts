/**
 * Phase 08 T07 — coverage for resource://report-schema.
 *
 * The resource is the discovery surface that lets calling LLMs see the
 * ValidationReport contract before constructing their JSON. If anything
 * here breaks, the upstream failure mode returns (field report
 * 2026-06-15: models skip finalize_validation_report after exhausting
 * the retry policy with no actionable feedback).
 */

import { describe, it, expect } from 'vitest';
import { buildReportSchemaResource, MINIMAL_VALID_SKELETON } from './report-schema.js';
import { parseValidationReport } from '../validation/schema.js';
import { finalizeValidationReport } from '../tools/finalize-validation-report.js';

describe('buildReportSchemaResource', () => {
  const body = buildReportSchemaResource();

  it('contains the three documented sections', () => {
    expect(body).toContain('## JSON Schema');
    expect(body).toContain('## Minimal-valid skeleton');
    expect(body).toContain('## Worked example');
  });

  it('embeds JSON Schema that parses as valid JSON', () => {
    const match = body.match(/## JSON Schema\s*\n\s*```json\n([\s\S]*?)\n```/);
    expect(match, 'JSON Schema fenced block must exist').toBeTruthy();
    const schema = JSON.parse(match![1]!) as Record<string, unknown>;
    // zod-to-json-schema emits a top-level object with `type: 'object'`
    // and `properties`; the exact $schema URI varies by version.
    expect(schema['type']).toBe('object');
    expect(schema['properties']).toBeTruthy();
  });

  it('embeds a skeleton that round-trips through parseValidationReport', () => {
    const match = body.match(/## Minimal-valid skeleton[\s\S]*?```json\n([\s\S]*?)\n```/);
    expect(match, 'skeleton fenced block must exist').toBeTruthy();
    const skeletonFromMarkdown = JSON.parse(match![1]!);
    const result = parseValidationReport(skeletonFromMarkdown);
    expect(result.ok).toBe(true);
  });

  it('keeps the exported skeleton constant in sync with the rendered body', () => {
    // Defensive: if someone edits the constant but the resource body
    // diverges (e.g. someone hard-codes a stale literal in the builder),
    // catch it here.
    expect(body).toContain(JSON.stringify(MINIMAL_VALID_SKELETON.header.idea));
  });
});

describe('MINIMAL_VALID_SKELETON', () => {
  it('passes parseValidationReport', () => {
    const result = parseValidationReport(MINIMAL_VALID_SKELETON);
    expect(result.ok).toBe(true);
  });

  it('passes the full finalize pipeline (no fundamental structural issues)', () => {
    const result = finalizeValidationReport(JSON.stringify(MINIMAL_VALID_SKELETON));
    // The verdict-validator may downgrade the verdict — that's expected
    // and surfaces via adjustments_made. What we care about is that the
    // pipeline reaches render (status: 'ok'), not that the verdict is
    // unchanged.
    expect(result.status).toBe('ok');
  });
});
