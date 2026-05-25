/**
 * Structural validator — closes anti-bias mechanisms H1 + H2.
 *
 * Runs AFTER the zod schema parse (T06) succeeds and BEFORE verdict math
 * (T08). Its job is to enforce the spec §1/§5/§11 structural invariants that
 * are too semantic for zod alone:
 *
 *   H1a — DOK 1–4 layer separation per gate    (spec §5 + §11 anti-pattern 1)
 *   H1b — Contradicting Evidence present       (spec §1 mechanism 3 + §11 #3)
 *   H1c — DOK 1 fact citation completeness     (spec §4 runtime requirement)
 *   H2  — Spiky POV stays the blank template   (spec §1 mechanism 5 + §11 #4)
 *
 * Output: `ValidationIssue[]`. Fundamental issues block rendering downstream
 * (the `finalize_validation_report` tool returns `ok: false`). Major issues
 * propagate to the report's overall-confidence calculation in T08.
 *
 * Spec refs:
 *   §1   — 5 anti-bias mechanisms (especially #2 DOK separation, #3
 *          Contradicting Evidence, #5 blank Spiky POV)
 *   §5   — artifact spec (all 8 sections)
 *   §6.1 — Step 1e (Contradicting Evidence), Step 6 (Spiky POV blank)
 *   §11  — anti-patterns 1, 3, 4
 *   Appendix B(4) — Spiky POV blank by design, not a TODO
 */

import type {
  ContradictingEvidence,
  DOK1Fact,
  GateReport,
  ValidationIssue,
  ValidationReport,
} from './types.js';

// ──────────────────────────────────────────────────────────────────────────
// Canonical strings — re-exported from ./constants.ts to avoid an import
// cycle with the fixtures (which the self-check block at the bottom of this
// file pulls in dynamically). The constants are SoT in `./constants.ts`.
// ──────────────────────────────────────────────────────────────────────────

export {
  SPIKY_POV_BLANK_TEMPLATE,
  CONTRADICTING_EVIDENCE_NONE_SENTINEL,
} from './constants.js';
import { SPIKY_POV_BLANK_TEMPLATE, CONTRADICTING_EVIDENCE_NONE_SENTINEL } from './constants.js';

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const VALID_TIERS = new Set(['S', 'A', 'B', 'C', 'D']);
const VALID_BIASES = new Set([
  'independent',
  'vendor-funded',
  'conflicted',
  'unknown',
]);

function issue(
  severity: ValidationIssue['severity'],
  code: string,
  message: string,
  location: string
): ValidationIssue {
  return { severity, code, message, location };
}

function isBlank(s: string | undefined | null): boolean {
  return !s || s.trim().length === 0;
}

// ──────────────────────────────────────────────────────────────────────────
// Per-gate checks
// ──────────────────────────────────────────────────────────────────────────

function checkDokLayerSeparation(
  gate: GateReport,
  issues: ValidationIssue[]
): void {
  const loc = `gates[${gate.gate - 1}]`;

  // H1a — every DOK layer must exist for every gate. Spec §5 + §11 #1.
  if (!Array.isArray(gate.dok1_facts) || gate.dok1_facts.length === 0) {
    issues.push(
      issue(
        'fundamental',
        'dok1_missing',
        `Gate ${gate.gate} has no DOK 1 facts — every gate must cite ≥1 raw sourced fact.`,
        `${loc}.dok1_facts`
      )
    );
  }
  if (isBlank(gate.dok2_summary)) {
    issues.push(
      issue(
        'fundamental',
        'dok2_missing',
        `Gate ${gate.gate} has no DOK 2 summary — plain restatement of facts is mandatory.`,
        `${loc}.dok2_summary`
      )
    );
  }
  if (!Array.isArray(gate.dok3_insights) || gate.dok3_insights.length === 0) {
    issues.push(
      issue(
        'fundamental',
        'dok3_missing',
        `Gate ${gate.gate} has no DOK 3 insights — labeled model judgment is mandatory.`,
        `${loc}.dok3_insights`
      )
    );
  }
  const dok4 = gate.dok4_verdict;
  if (
    !dok4 ||
    !['PASS', 'FAIL', 'INCONCLUSIVE'].includes(dok4.status) ||
    isBlank(dok4.reasoning)
  ) {
    issues.push(
      issue(
        'fundamental',
        'dok4_missing',
        `Gate ${gate.gate} DOK 4 verdict missing or malformed — needs status ∈ {PASS,FAIL,INCONCLUSIVE} + reasoning.`,
        `${loc}.dok4_verdict`
      )
    );
  }
}

function checkContradictingEvidence(
  gate: GateReport,
  issues: ValidationIssue[]
): void {
  const loc = `gates[${gate.gate - 1}].contradicting_evidence`;
  const entries: ContradictingEvidence[] = gate.contradicting_evidence ?? [];

  if (entries.length === 0) {
    // H1b — absence of section is a fundamental violation. Spec §1 #3.
    issues.push(
      issue(
        'fundamental',
        'contradicting_evidence_missing',
        `Gate ${gate.gate} is missing the Contradicting Evidence block. Provide ≥1 counter-claim OR the explicit "none surfaced" sentinel.`,
        loc
      )
    );
    return;
  }

  const hasSubstantive = entries.some(
    (e) => e.source != null && !isBlank(e.text)
  );
  const hasSentinel = entries.some(
    (e) => e.text === CONTRADICTING_EVIDENCE_NONE_SENTINEL
  );

  if (!hasSubstantive && !hasSentinel) {
    issues.push(
      issue(
        'fundamental',
        'contradicting_evidence_missing',
        `Gate ${gate.gate} contradicting_evidence has entries but none are substantive and the "none surfaced" sentinel string is absent. Spec §6.1 Step 1e requires the exact sentinel when no counter-evidence is found.`,
        loc
      )
    );
  }
}

function checkDok1FactCitations(
  gate: GateReport,
  issues: ValidationIssue[]
): void {
  // H1c — every DOK 1 fact must have url + tier + bias + fetched_at.
  // Spec §4 runtime requirement.
  const facts: DOK1Fact[] = gate.dok1_facts ?? [];
  facts.forEach((fact, idx) => {
    const loc = `gates[${gate.gate - 1}].dok1_facts[${idx}].source`;
    const s = fact.source;
    if (!s) {
      issues.push(
        issue(
          'major',
          'dok1_fact_source_missing',
          `Gate ${gate.gate} DOK 1 fact #${idx + 1} has no source — spec §4 requires url+tier+bias+fetched_at.`,
          loc
        )
      );
      return;
    }
    if (isBlank(s.url)) {
      issues.push(
        issue('major', 'dok1_fact_url_missing', `Gate ${gate.gate} DOK 1 fact #${idx + 1} missing source.url.`, `${loc}.url`)
      );
    }
    if (!VALID_TIERS.has(s.tier)) {
      issues.push(
        issue(
          'major',
          'dok1_fact_tier_invalid',
          `Gate ${gate.gate} DOK 1 fact #${idx + 1} has invalid tier "${s.tier}" — must be one of S/A/B/C/D.`,
          `${loc}.tier`
        )
      );
    }
    if (!VALID_BIASES.has(s.bias)) {
      issues.push(
        issue(
          'major',
          'dok1_fact_bias_invalid',
          `Gate ${gate.gate} DOK 1 fact #${idx + 1} has invalid bias "${s.bias}" — must be one of independent/vendor-funded/conflicted/unknown.`,
          `${loc}.bias`
        )
      );
    }
    if (isBlank(s.fetched_at)) {
      issues.push(
        issue(
          'major',
          'dok1_fact_fetched_at_missing',
          `Gate ${gate.gate} DOK 1 fact #${idx + 1} missing source.fetched_at — required by spec §4 runtime requirement.`,
          `${loc}.fetched_at`
        )
      );
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Report-level checks
// ──────────────────────────────────────────────────────────────────────────

function checkSpikyPov(
  report: ValidationReport,
  issues: ValidationIssue[]
): void {
  // H2 — Spiky POV section must be the canonical blank template, byte-for-byte.
  // Spec §1 mechanism 5 + Appendix B(4) + §11 anti-pattern 4.
  const tmpl = report.spiky_pov?.template ?? '';
  if (tmpl !== SPIKY_POV_BLANK_TEMPLATE) {
    issues.push(
      issue(
        'fundamental',
        'spiky_pov_violation',
        'Spiky POV section is not the canonical blank template. The user fills this in — the model must emit the template verbatim and add no content of its own.',
        'spiky_pov.template'
      )
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────────────────────────────────

/**
 * Run structural validation on a parsed `ValidationReport`. Returns the list
 * of issues found; an empty list means the report passed structural checks.
 *
 * This function does NOT mutate the report. Mutation (verdict downgrades) is
 * the verdict validator's responsibility (T08).
 */
export function structuralValidate(
  report: ValidationReport
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Sanity guard — schema (T06) should have already caught these, but the
  // structural validator is the last line of defense before render.
  if (!report || !Array.isArray(report.gates) || report.gates.length !== 5) {
    issues.push(
      issue(
        'fundamental',
        'gates_count_invalid',
        `Report must contain exactly 5 gates; got ${report?.gates?.length ?? 0}.`,
        'gates'
      )
    );
    return issues;
  }

  for (const gate of report.gates) {
    checkDokLayerSeparation(gate, issues);
    checkContradictingEvidence(gate, issues);
    checkDok1FactCitations(gate, issues);
  }
  checkSpikyPov(report, issues);

  return issues;
}

// ──────────────────────────────────────────────────────────────────────────
// Self-check block (acceptance test for T07)
//
// Run with: `npx tsx src/validation/structural-validator.ts`
//
// Asserts that each synthetic fixture in __fixtures__/synthetic-report.ts
// produces the expected issue codes. Exits non-zero on any mismatch — this
// is the task's mechanical acceptance test.
// ──────────────────────────────────────────────────────────────────────────

import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';

function __isMainModule(metaUrl: string): boolean {
  if (typeof process === 'undefined' || typeof process.argv[1] !== 'string') {
    return false;
  }
  try {
    const here = realpathSync(fileURLToPath(metaUrl));
    const main = realpathSync(process.argv[1]);
    return here === main;
  } catch {
    return false;
  }
}

if (__isMainModule(import.meta.url)) {
  // Lazy-imported to avoid pulling fixtures into the production bundle.
  const fixturesModule: typeof import('./__fixtures__/synthetic-report.js') =
    await import('./__fixtures__/synthetic-report.js');
  const {
    validReport,
    reportMissingDok3,
    reportFilledPov,
    reportMissingContradicting,
  } = fixturesModule;

  type Case = {
    name: string;
    report: ValidationReport;
    expectCodes: string[]; // codes that MUST be present (subset match)
    expectEmpty?: boolean; // true means: expect ZERO issues
  };

  const cases: Case[] = [
    { name: 'validReport', report: validReport, expectCodes: [], expectEmpty: true },
    {
      name: 'reportMissingDok3',
      report: reportMissingDok3,
      expectCodes: ['dok3_missing'],
    },
    {
      name: 'reportFilledPov',
      report: reportFilledPov,
      expectCodes: ['spiky_pov_violation'],
    },
    {
      name: 'reportMissingContradicting',
      report: reportMissingContradicting,
      expectCodes: ['contradicting_evidence_missing'],
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const issues = structuralValidate(c.report);
    const codes = issues.map((i) => i.code);
    let ok = true;
    if (c.expectEmpty && issues.length !== 0) ok = false;
    for (const required of c.expectCodes) {
      if (!codes.includes(required)) ok = false;
    }
    const summary =
      issues.length === 0
        ? '0 issues'
        : `${issues.length} issue(s): ${codes.join(', ')}`;
    console.error(`[T07 self-check] ${c.name}: ${ok ? 'PASS' : 'FAIL'} — ${summary}`);
    if (!ok) failed++;
  }

  if (failed > 0) {
    console.error(`[T07 self-check] ${failed} case(s) failed`);
    process.exit(1);
  }
  console.error('[T07 self-check] all cases passed');
}
