/**
 * Synthetic `ValidationReport` fixtures used by the structural + verdict
 * validator self-check blocks (T07, T08).
 *
 * Not Vitest. Not wired into any production code path. Used only when
 * `structural-validator.ts` or `verdict-validator.ts` is executed directly
 * (e.g. `npx tsx src/validation/structural-validator.ts`).
 */

import type {
  GateReport,
  GateSummaryRow,
  ValidationReport,
  ValidationCheck,
} from '../types.js';
import {
  SPIKY_POV_BLANK_TEMPLATE,
  CONTRADICTING_EVIDENCE_NONE_SENTINEL,
} from '../constants.js';

const ISO = '2026-05-20T12:00:00Z';

function tierBSource(url: string, bias: 'independent' | 'conflicted' = 'independent') {
  return {
    url,
    tier: 'B' as const,
    bias,
    fetched_at: ISO,
    contribution: 'aggregate review pattern',
  };
}

function tierASource(url: string, bias: 'independent' | 'conflicted' = 'independent') {
  return {
    url,
    tier: 'A' as const,
    bias,
    fetched_at: ISO,
    contribution: 'public revenue signal',
  };
}

function tierDSource(url: string) {
  return {
    url,
    tier: 'D' as const,
    bias: 'unknown' as const,
    fetched_at: ISO,
    contribution: 'low-signal forum comment',
  };
}

function emptyMix() {
  return {
    tiers: { S: 0, A: 0, B: 2, C: 0, D: 0 },
    bias: { independent: 2, 'vendor-funded': 0, conflicted: 0, unknown: 0 },
  };
}

/** Build a generic gate with PASS verdict and 2 tier-B independent facts. */
function makeGate(gate: 1 | 2 | 3 | 4 | 5, name: string): GateReport {
  return {
    gate,
    name,
    status: 'PASS',
    confidence: 'Medium',
    dok1_facts: [
      {
        text: `Fact A for gate ${gate}.`,
        source: tierBSource(`https://example.com/g${gate}/a`),
      },
      {
        text: `Fact B for gate ${gate}.`,
        source: tierBSource(`https://example.com/g${gate}/b`),
      },
    ],
    dok2_summary: `Plain restatement of the facts above for gate ${gate}.`,
    dok3_insights: [
      {
        text: `Cross-fact insight for gate ${gate}.`,
        is_model_judgment: true,
      },
    ],
    contradicting_evidence: [
      { text: CONTRADICTING_EVIDENCE_NONE_SENTINEL, source: null },
    ],
    dok4_verdict: {
      status: 'PASS',
      confidence: 'Medium',
      reasoning: `Gate ${gate} passes because the cited B-tier evidence aligns with the criteria.`,
    },
    source_meta: {
      consulted: 2,
      ...emptyMix(),
    },
  };
}

function makeGateSummary(): GateSummaryRow[] {
  return ([1, 2, 3, 4, 5] as const).map((g) => ({
    gate: g,
    name: `Gate ${g}`,
    status: 'PASS' as const,
    reason: 'placeholder',
  }));
}

function makeValidationChecks(
  outcomes?: Array<'No issues' | 'Minor' | 'Major' | 'Fundamental'>
): ValidationCheck[] {
  const [a, b, c] = outcomes ?? ['No issues', 'No issues', 'No issues'];
  return [
    {
      name: 'Source Quality Audit',
      rows: [
        { dimension: 'Authority', finding: 'mixed B/A tier' },
        { dimension: 'Recency', finding: 'sources within 18 months' },
      ],
      outcome: a!,
      notes: '',
    },
    {
      name: 'Counterargument Search',
      rows: [{ dimension: 'Critics', finding: 'standard objections found' }],
      outcome: b!,
      notes: '',
    },
    {
      name: 'Logic & Coherence Review',
      rows: [{ dimension: 'Consistency', finding: 'internally consistent' }],
      outcome: c!,
      notes: '',
    },
  ];
}

// ──────────────────────────────────────────────────────────────────────────
// Base valid report
// ──────────────────────────────────────────────────────────────────────────

export const validReport: ValidationReport = {
  header: {
    idea: 'A synthetic idea for testing.',
    audience: 'B2B',
    builder: 'solo',
    generated_at: ISO,
    mcp_version: '0.2.0',
    total_sources_consulted: 10,
    source_quality_mix: { S: 0, A: 0, B: 10, C: 0, D: 0 },
    bias_mix: { independent: 10, 'vendor-funded': 0, conflicted: 0, unknown: 0 },
  },
  verdict: {
    overall: 'GO',
    overall_confidence: 'Medium',
    gate_summary: makeGateSummary(),
    killshots: [],
  },
  gates: [makeGate(1, 'Direct Competitor Scan'), makeGate(2, 'Market Structure'), makeGate(3, 'Platform & Big-Tech Risk'), makeGate(4, 'Willingness to Pay'), makeGate(5, 'Why Now')],
  validation_checks: makeValidationChecks(),
  test_cards: [],
  spiky_pov: { template: SPIKY_POV_BLANK_TEMPLATE },
  source_appendix: [],
  methodology_notes: {
    tool_calls: [],
    tool_calls_fired: 0,
    validation_rules_in_force: 'spec v1.0',
    disclaimer: 'This is a decision aid, not a verdict — final call is yours.',
  },
};

// Deep-clone helper — fixtures derive variants from `validReport`.
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

// ──────────────────────────────────────────────────────────────────────────
// Variant: Gate 2 missing DOK 3 insights → expect `dok3_missing`
// ──────────────────────────────────────────────────────────────────────────

export const reportMissingDok3: ValidationReport = (() => {
  const r = clone(validReport);
  r.gates[1]!.dok3_insights = [];
  return r;
})();

// ──────────────────────────────────────────────────────────────────────────
// Variant: Spiky POV populated → expect `spiky_pov_violation`
// ──────────────────────────────────────────────────────────────────────────

export const reportFilledPov: ValidationReport = (() => {
  const r = clone(validReport);
  r.spiky_pov.template =
    SPIKY_POV_BLANK_TEMPLATE.replace(
      '[user fills in]',
      'I think this idea is great because the LLM said so.'
    );
  return r;
})();

// ──────────────────────────────────────────────────────────────────────────
// Variant: Gate 3 has contradicting_evidence entries but no sentinel and
// no substantive (source-backed) entry → expect contradicting_evidence_missing
// ──────────────────────────────────────────────────────────────────────────

export const reportMissingContradicting: ValidationReport = (() => {
  const r = clone(validReport);
  r.gates[2]!.contradicting_evidence = [
    // Has text but no source, and text is NOT the canonical sentinel.
    { text: 'some vague concern', source: null },
  ];
  return r;
})();

// ──────────────────────────────────────────────────────────────────────────
// Extra fixtures used by T08's verdict validator self-check.
// ──────────────────────────────────────────────────────────────────────────

/** PASS verdict on Gate 1 supported by only ONE tier-B source → must downgrade. */
export const reportPassWithOneSource: ValidationReport = (() => {
  const r = clone(validReport);
  r.gates[0]!.dok1_facts = [
    {
      text: 'Single supporting fact for gate 1.',
      source: tierBSource('https://example.com/g1/only'),
    },
  ];
  r.gates[0]!.status = 'PASS';
  r.gates[0]!.dok4_verdict.status = 'PASS';
  return r;
})();

/** All D-tier sources on a gate → must override status to INCONCLUSIVE. */
export const reportAllDTier: ValidationReport = (() => {
  const r = clone(validReport);
  r.gates[1]!.dok1_facts = [
    { text: 'D-only fact 1', source: tierDSource('https://example.com/g2/d1') },
    { text: 'D-only fact 2', source: tierDSource('https://example.com/g2/d2') },
  ];
  r.gates[1]!.status = 'PASS';
  r.gates[1]!.dok4_verdict.status = 'PASS';
  return r;
})();

/** Synthetic NO-GO with 2 gate fails — overall must remain NO-GO. */
export const reportNoGo: ValidationReport = (() => {
  const r = clone(validReport);
  r.gates[0]!.status = 'FAIL';
  r.gates[0]!.dok4_verdict.status = 'FAIL';
  r.gates[1]!.status = 'FAIL';
  r.gates[1]!.dok4_verdict.status = 'FAIL';
  // Give the FAIL gates ≥2 B-tier facts so they aren't auto-downgraded.
  // (FAIL doesn't trigger the ≥2-source rule, but be explicit.)
  r.verdict.overall = 'NO-GO';
  // Killshots cite real DOK 1 source URLs from the failed gates.
  r.verdict.killshots = [
    {
      reason: 'Dominant competitor shipping aggressively.',
      cited_source_urls: ['https://example.com/g1/a'],
    },
    {
      reason: 'Category dominated by free alternatives.',
      cited_source_urls: ['https://example.com/g2/a'],
    },
  ];
  return r;
})();

/**
 * Validation checks all flagged as `Major` → overall confidence must drop
 * to Low. Gate verdicts are otherwise PASS-clean.
 */
export const reportAllMajorChecks: ValidationReport = (() => {
  const r = clone(validReport);
  r.validation_checks = makeValidationChecks(['Major', 'Major', 'Major']);
  // Ensure gates support PASS so the drop is attributable to checks, not source-count.
  r.gates[0]!.dok1_facts.push({
    text: 'Extra B source for safety.',
    source: tierASource('https://example.com/g1/extra'),
  });
  return r;
})();

/** A Fundamental validation check → overall must become INCONCLUSIVE. */
export const reportFundamentalCheck: ValidationReport = (() => {
  const r = clone(validReport);
  r.validation_checks = makeValidationChecks(['No issues', 'Fundamental', 'No issues']);
  return r;
})();
