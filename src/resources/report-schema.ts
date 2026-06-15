/**
 * Phase 08 T02 — resource://report-schema builder.
 *
 * Returns a markdown document containing:
 *   1. The live JSON Schema (derived from ValidationReportSchema via
 *      zod-to-json-schema, refs flattened so the LLM sees inlined enums).
 *   2. A minimal-valid skeleton — the smallest ValidationReport that
 *      passes both `parseValidationReport` (Zod) and `structuralValidate`
 *      (Phase 01 INVIOLATE rules). The verdict-validator may downgrade
 *      the skeleton's verdict (e.g. PASS → INCONCLUSIVE because each
 *      gate cites only 1 tier-B source) — that's fine. The skeleton's
 *      job is to communicate SHAPE; the LLM is expected to construct
 *      its own facts and verdict.
 *   3. An abbreviated worked example — a NO-GO report with killshots —
 *      so the LLM sees what populated fields look like in practice.
 *
 * The minimal skeleton is authored inline (not imported from
 * src/validation/__fixtures__/) because the fixture file's header
 * explicitly says it's not for production wiring.
 *
 * Phase 08 PLAN.md T02; CONTEXT.md decisions 3 + 5.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import { ValidationReportSchema } from '../validation/schema.js';
import {
  SPIKY_POV_BLANK_TEMPLATE,
  CONTRADICTING_EVIDENCE_NONE_SENTINEL,
} from '../validation/constants.js';
import type { ValidationReport, GateReport } from '../validation/types.js';

const ISO = '2026-01-01T00:00:00Z';

function minimalGate(gate: 1 | 2 | 3 | 4 | 5, name: string): GateReport {
  return {
    gate,
    name,
    status: 'PASS',
    confidence: 'Medium',
    dok1_facts: [
      {
        text: `Replace with a real fact for ${name}.`,
        source: {
          url: `https://example.com/gate-${gate}-source`,
          tier: 'B',
          bias: 'independent',
          fetched_at: ISO,
          contribution: 'replace with the role this source plays for this fact',
        },
      },
    ],
    dok2_summary: `Plain restatement of the ${name} facts (1-3 sentences).`,
    dok3_insights: [
      {
        text: `Replace with a cross-fact insight for ${name}.`,
        is_model_judgment: true,
      },
    ],
    contradicting_evidence: [
      { text: CONTRADICTING_EVIDENCE_NONE_SENTINEL, source: null },
    ],
    dok4_verdict: {
      status: 'PASS',
      confidence: 'Medium',
      reasoning: `Replace with the verdict reasoning for ${name}.`,
    },
    source_meta: {
      consulted: 1,
      tiers: { S: 0, A: 0, B: 1, C: 0, D: 0 },
      bias: { independent: 1, 'vendor-funded': 0, conflicted: 0, unknown: 0 },
    },
  };
}

/**
 * The smallest ValidationReport that passes both the Zod schema and the
 * structural validator. Exported for reuse in the enriched failure
 * envelope (Phase 08 T05) and the tests (T07).
 */
export const MINIMAL_VALID_SKELETON: ValidationReport = {
  header: {
    idea: 'Replace with the idea under evaluation.',
    audience: 'B2B',
    builder: 'solo',
    generated_at: ISO,
    mcp_version: '0.1.0',
    total_sources_consulted: 5,
    source_quality_mix: { S: 0, A: 0, B: 5, C: 0, D: 0 },
    bias_mix: { independent: 5, 'vendor-funded': 0, conflicted: 0, unknown: 0 },
  },
  verdict: {
    overall: 'INCONCLUSIVE',
    overall_confidence: 'Low',
    gate_summary: [
      { gate: 1, name: 'Direct Competitor Scan', status: 'PASS', reason: 'placeholder' },
      { gate: 2, name: 'Market Structure', status: 'PASS', reason: 'placeholder' },
      { gate: 3, name: 'Platform & Big-Tech Risk', status: 'PASS', reason: 'placeholder' },
      { gate: 4, name: 'Willingness to Pay', status: 'PASS', reason: 'placeholder' },
      { gate: 5, name: 'Why Now', status: 'PASS', reason: 'placeholder' },
    ],
    killshots: [],
  },
  gates: [
    minimalGate(1, 'Direct Competitor Scan'),
    minimalGate(2, 'Market Structure'),
    minimalGate(3, 'Platform & Big-Tech Risk'),
    minimalGate(4, 'Willingness to Pay'),
    minimalGate(5, 'Why Now'),
  ],
  validation_checks: [
    {
      name: 'Source Quality Audit',
      rows: [{ dimension: 'Authority', finding: 'Replace with a finding.' }],
      outcome: 'No issues',
      notes: '',
    },
    {
      name: 'Counterargument Search',
      rows: [{ dimension: 'Critics', finding: 'Replace with a finding.' }],
      outcome: 'No issues',
      notes: '',
    },
    {
      name: 'Logic & Coherence Review',
      rows: [{ dimension: 'Consistency', finding: 'Replace with a finding.' }],
      outcome: 'No issues',
      notes: '',
    },
  ],
  test_cards: [
    {
      id: 'TC-1',
      belief: 'Replace with a falsifiable belief that must be true for the idea to work.',
      verification_method: 'Replace with the cheapest test design.',
      metric: 'Replace with the exact metric.',
      success_threshold: 'Replace with the pass/fail threshold.',
      linked_gate: 1,
      cheapest_test: 'Replace with how to run this test in <1 week.',
    },
  ],
  spiky_pov: { template: SPIKY_POV_BLANK_TEMPLATE },
  source_appendix: [
    {
      index: 1,
      source: {
        url: 'https://example.com/gate-1-source',
        tier: 'B',
        bias: 'independent',
        fetched_at: ISO,
        contribution: 'replace with the role this source plays for this fact',
      },
      gates: [1],
      dok_layers: [1],
    },
  ],
  methodology_notes: {
    tool_calls: [],
    tool_calls_fired: 0,
    validation_rules_in_force: 'spec v1.0',
    disclaimer: 'This is a decision aid, not a verdict — final call is yours.',
  },
};

/**
 * A populated NO-GO example so the LLM sees how killshots, conflicted
 * sources, and Major validation-check outcomes look in practice. Trimmed
 * to keep the resource body compact; this is illustrative, not a fixture.
 */
const WORKED_EXAMPLE_NOGO: ValidationReport = {
  ...MINIMAL_VALID_SKELETON,
  header: {
    ...MINIMAL_VALID_SKELETON.header,
    idea: 'AI-native focus app for iPhone that uses on-device ML to reduce screen time.',
    total_sources_consulted: 12,
    source_quality_mix: { S: 1, A: 2, B: 7, C: 1, D: 1 },
    bias_mix: { independent: 9, 'vendor-funded': 1, conflicted: 1, unknown: 1 },
  },
  verdict: {
    overall: 'NO-GO',
    overall_confidence: 'High',
    gate_summary: [
      { gate: 1, name: 'Direct Competitor Scan', status: 'FAIL', reason: 'Apple Screen Time ships with iOS' },
      { gate: 2, name: 'Market Structure', status: 'PASS', reason: 'category exists' },
      { gate: 3, name: 'Platform & Big-Tech Risk', status: 'FAIL', reason: 'Apple owns the surface and the API' },
      { gate: 4, name: 'Willingness to Pay', status: 'INCONCLUSIVE', reason: 'free alternatives dominate' },
      { gate: 5, name: 'Why Now', status: 'INCONCLUSIVE', reason: 'no fresh catalyst' },
    ],
    killshots: [
      {
        reason: 'Apple ships Screen Time as a free OS feature — feature, not product.',
        cited_source_urls: ['https://example.com/apple-screen-time'],
      },
      {
        reason: 'Platform owner controls the App Tracking and DeviceActivity APIs you would need.',
        cited_source_urls: ['https://example.com/deviceactivity-api'],
      },
    ],
  },
};

const PREAMBLE = `# ValidationReport — schema, skeleton, example

_The JSON Schema below is authoritative and generated from \`ValidationReportSchema\` at resource read time. If anything in this document drifts from the schema, trust the schema._

This resource is referenced by the \`validate_idea\` prompt. Load it BEFORE constructing the \`ValidationReport\` JSON you pass to \`finalize_validation_report\`. The three sections below answer:

- **JSON Schema** — every field, type, enum value, and structural rule the parser checks.
- **Minimal-valid skeleton** — the smallest report shape that passes the parser. Copy it and replace every \`"Replace with…"\` string with your actual content. The verdict-validator may downgrade your verdict if your sources don't support it — that's expected and surfaced via \`adjustments_made\`.
- **Worked example** — a populated NO-GO report so you see how \`killshots\`, mixed source tiers, and a real verdict look.

If \`finalize_validation_report\` returns \`status: validation_failed\`, the response includes \`expected_skeleton\` (this same skeleton) and a \`hints[]\` array with one entry per issue — use those to correct your JSON on the retry attempt.

`;

/**
 * Build the resource body. Pure function — no I/O, no caching. Cost is
 * microseconds per call so we don't pre-generate at build time.
 */
export function buildReportSchemaResource(): string {
  const jsonSchema = zodToJsonSchema(ValidationReportSchema, {
    name: 'ValidationReport',
    $refStrategy: 'none',
  });

  const sections = [
    PREAMBLE,
    '## JSON Schema',
    '',
    '```json',
    JSON.stringify(jsonSchema, null, 2),
    '```',
    '',
    '## Minimal-valid skeleton',
    '',
    'Smallest ValidationReport that passes the parser. Replace every `"Replace with…"` string with real content before submitting.',
    '',
    '```json',
    JSON.stringify(MINIMAL_VALID_SKELETON, null, 2),
    '```',
    '',
    '## Worked example (NO-GO)',
    '',
    'A populated example showing killshots, mixed source tiers, and a high-confidence NO-GO verdict. Most fields are abbreviated for clarity — populate them fully in real reports.',
    '',
    '```json',
    JSON.stringify(WORKED_EXAMPLE_NOGO, null, 2),
    '```',
    '',
  ];

  return sections.join('\n');
}
