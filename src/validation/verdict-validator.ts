/**
 * Verdict validator — closes anti-bias mechanisms H4 + H5.
 *
 * Runs AFTER the structural validator (T07) and BEFORE the renderer (T09a).
 * Unlike T07 (which only reports issues), this validator MUTATES gate and
 * overall verdicts to enforce mechanical spec rules the LLM cannot route
 * around.
 *
 * Enforced rules:
 *   H4  — PASS requires ≥2 tier-B-or-higher sources per gate.   (spec §4 #1)
 *   H4b — C/D-only evidence on a gate → INCONCLUSIVE override. (spec §4 #3)
 *   H4c — >30% effective-bias `conflicted` deciding sources →   (spec §4 #2)
 *         downgrade the gate's confidence by one level.
 *   H5  — Validation-check decision matrix:                      (spec §3)
 *           any Fundamental check → overall verdict overridden to INCONCLUSIVE
 *           any Major check       → overall confidence downgraded to Low
 *           Minor only            → caveat (no math change)
 *   Mechanical-then-override order (Appendix B(5)):
 *           fail-2 verdict math runs FIRST on (possibly adjusted) gate verdicts;
 *           Validation Checks can override the result.
 *
 * Spec refs: §3 verdict math, §4 rules 1–4, §6.1 Step 3 + Step 4,
 * Appendix B(5), §11 anti-patterns 3 + 5.
 */

import { effectiveBias, exceedsConflictThreshold } from '../lib/bias.js';
import type { ToolSource } from '../types.js';
import type {
  Confidence,
  DOK1Fact,
  GateReport,
  GateStatus,
  OverallVerdict,
  ValidationCheckOutcome,
  ValidationIssue,
  ValidationReport,
} from './types.js';

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const DECIDING_TIERS = new Set<ToolSource['tier']>(['S', 'A', 'B']);

function issue(
  severity: ValidationIssue['severity'],
  code: string,
  message: string,
  location: string
): ValidationIssue {
  return { severity, code, message, location };
}

function downgradeConfidence(c: Confidence): Confidence {
  if (c === 'High') return 'Medium';
  if (c === 'Medium') return 'Low';
  return 'Low';
}

/** Sources for a gate, deduped by URL (a fact may be cited multiple times). */
function gateSources(gate: GateReport): ToolSource[] {
  const seen = new Set<string>();
  const out: ToolSource[] = [];
  for (const f of gate.dok1_facts ?? []) {
    if (!f?.source?.url) continue;
    if (seen.has(f.source.url)) continue;
    seen.add(f.source.url);
    out.push(f.source);
  }
  return out;
}

function decidingSources(gate: GateReport): ToolSource[] {
  return gateSources(gate).filter((s) => DECIDING_TIERS.has(s.tier));
}

// ──────────────────────────────────────────────────────────────────────────
// Per-gate enforcement (H4, H4b, H4c)
// ──────────────────────────────────────────────────────────────────────────

function enforceSourceCountRules(
  gate: GateReport,
  issues: ValidationIssue[]
): void {
  const loc = `gates[${gate.gate - 1}]`;
  const all = gateSources(gate);
  const deciding = decidingSources(gate);

  // H4b — C/D-only evidence: gate cannot validate (spec §4 rule 3).
  if (all.length > 0 && deciding.length === 0) {
    if (gate.status !== 'INCONCLUSIVE') {
      issues.push(
        issue(
          'major',
          'gate_all_c_or_d_tier',
          `Gate ${gate.gate} has no S/A/B-tier sources — D-tier never validates (spec §4 rule 3). Status overridden to INCONCLUSIVE.`,
          `${loc}.dok1_facts`
        )
      );
      gate.status = 'INCONCLUSIVE';
      gate.dok4_verdict.status = 'INCONCLUSIVE';
    }
    return;
  }

  // H4 — PASS requires ≥2 deciding-tier sources (spec §4 rule 1).
  if (gate.status === 'PASS' && deciding.length < 2) {
    issues.push(
      issue(
        'major',
        'pass_insufficient_sources',
        `Gate ${gate.gate} asserted PASS with ${deciding.length} tier-S/A/B source(s); spec §4 rule 1 requires ≥2. Downgrading to INCONCLUSIVE.`,
        `${loc}.status`
      )
    );
    gate.status = 'INCONCLUSIVE';
    gate.dok4_verdict.status = 'INCONCLUSIVE';
  }

  // H4c — >30% conflicted in deciding-tier sources → downgrade gate confidence.
  if (deciding.length > 0 && exceedsConflictThreshold(deciding)) {
    const prev = gate.confidence;
    const next = downgradeConfidence(prev);
    if (prev !== next) {
      issues.push(
        issue(
          'minor',
          'gate_conflicted_majority',
          `Gate ${gate.gate} has >30% conflicted (effective-bias) deciding-tier sources; downgrading confidence ${prev} → ${next} (spec §4 rule 2).`,
          `${loc}.confidence`
        )
      );
      gate.confidence = next;
      gate.dok4_verdict.confidence = next;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Fail-2 verdict math (spec §3)
// ──────────────────────────────────────────────────────────────────────────

function computeFail2(gates: GateReport[]): OverallVerdict {
  let fails = 0;
  let inconclusives = 0;
  for (const g of gates) {
    if (g.status === 'FAIL') fails++;
    else if (g.status === 'INCONCLUSIVE') inconclusives++;
  }
  if (fails >= 2) return 'NO-GO';
  if (fails === 1 || inconclusives >= 2) return 'CONDITIONAL GO';
  return 'GO';
}

// ──────────────────────────────────────────────────────────────────────────
// Validation-check decision matrix (H5)
// ──────────────────────────────────────────────────────────────────────────

function highestOutcomeSeverity(
  outcomes: ValidationCheckOutcome[]
): ValidationCheckOutcome {
  const rank: Record<ValidationCheckOutcome, number> = {
    'No issues': 0,
    Minor: 1,
    Major: 2,
    Fundamental: 3,
  };
  let top: ValidationCheckOutcome = 'No issues';
  for (const o of outcomes) {
    if (rank[o] > rank[top]) top = o;
  }
  return top;
}

function applyDecisionMatrix(
  report: ValidationReport,
  fail2Verdict: OverallVerdict,
  issues: ValidationIssue[]
): { overall: OverallVerdict; confidence: Confidence } {
  const outcomes = report.validation_checks.map((c) => c.outcome);
  const worst = highestOutcomeSeverity(outcomes);

  let overall: OverallVerdict = fail2Verdict;
  let confidence: Confidence = report.verdict.overall_confidence;

  if (worst === 'Fundamental') {
    // H5 — Fundamental flaws override the verdict (spec §3).
    issues.push(
      issue(
        'fundamental',
        'validation_check_fundamental',
        'A Validation Check returned Fundamental — overall verdict overridden to INCONCLUSIVE regardless of fail-2 math (spec §3, §11 anti-pattern 5).',
        'validation_checks'
      )
    );
    overall = 'INCONCLUSIVE';
    confidence = 'Low';
  } else if (worst === 'Major') {
    // H5 — Major → drop overall confidence to Low (spec §3).
    if (confidence !== 'Low') {
      issues.push(
        issue(
          'major',
          'validation_check_major',
          `A Validation Check returned Major — overall confidence dropped ${confidence} → Low (spec §3).`,
          'verdict.overall_confidence'
        )
      );
      confidence = 'Low';
    }
  } else if (worst === 'Minor') {
    // Render verdict with caveat — no math change, but surface a minor issue
    // so the renderer can include the caveat note in the methodology section.
    issues.push(
      issue(
        'minor',
        'validation_check_minor',
        'A Validation Check returned Minor — verdict rendered with caveat (spec §3).',
        'validation_checks'
      )
    );
  }

  return { overall, confidence };
}

// ──────────────────────────────────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────────────────────────────────

export interface VerdictValidationResult {
  /**
   * Adjusted copy of the report with gate-level and overall verdict fields
   * mutated per the spec rules. The renderer consumes this; the LLM's
   * asserted verdict is OVERRIDDEN where the rules require.
   */
  adjusted_report: ValidationReport;
  /** All issues surfaced during verdict validation. */
  issues: ValidationIssue[];
}

/**
 * Apply spec §3 + §4 mechanical rules to the parsed report. Returns both
 * the adjusted report and the issue list. The caller (T09b
 * `finalize_validation_report`) merges these issues with T07's, decides
 * whether to render, and emits the markdown.
 *
 * Order (Appendix B(5) — mechanical-then-override):
 *   1. Per-gate source-count and bias rules → mutate gate.status/confidence.
 *   2. Fail-2 math on the adjusted gate verdicts → tentative overall verdict.
 *   3. Validation-Check decision matrix → may override overall verdict.
 */
export function verdictValidate(
  report: ValidationReport
): VerdictValidationResult {
  // Deep clone so the caller's input is untouched.
  const adjusted: ValidationReport = JSON.parse(JSON.stringify(report));
  const issues: ValidationIssue[] = [];

  // Step 1 — per-gate enforcement.
  for (const gate of adjusted.gates) {
    enforceSourceCountRules(gate, issues);
  }

  // Sync the gate_summary table so renderer reflects post-adjustment statuses.
  if (Array.isArray(adjusted.verdict.gate_summary)) {
    for (const row of adjusted.verdict.gate_summary) {
      const g = adjusted.gates.find((x) => x.gate === row.gate);
      if (g) {
        row.status = g.status;
      }
    }
  }

  // Step 2 — fail-2 math on adjusted gate verdicts.
  const fail2 = computeFail2(adjusted.gates);

  // Step 3 — decision matrix override.
  const { overall, confidence } = applyDecisionMatrix(adjusted, fail2, issues);

  // Apply overrides to the report.
  if (adjusted.verdict.overall !== overall) {
    issues.push(
      issue(
        overall === 'INCONCLUSIVE' ? 'major' : 'minor',
        'overall_verdict_override',
        `Overall verdict overridden from "${adjusted.verdict.overall}" to "${overall}" by mechanical rules (fail-2 math + decision matrix).`,
        'verdict.overall'
      )
    );
    adjusted.verdict.overall = overall;
  }
  if (adjusted.verdict.overall_confidence !== confidence) {
    adjusted.verdict.overall_confidence = confidence;
  }

  // Side-effect: silence unused-import warning if effectiveBias isn't called
  // directly in this file. (`exceedsConflictThreshold` already routes through
  // it; we keep this reference to make the dependency explicit.)
  void effectiveBias;

  return { adjusted_report: adjusted, issues };
}

// ──────────────────────────────────────────────────────────────────────────
// Self-check block — direct-invocation acceptance test for T08.
//
// Run with: `npx tsx src/validation/verdict-validator.ts`
// ──────────────────────────────────────────────────────────────────────────

import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';

function __isMainModule(metaUrl: string): boolean {
  if (typeof process === 'undefined' || typeof process.argv[1] !== 'string') {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (__isMainModule(import.meta.url)) {
  const fixtures: typeof import('./__fixtures__/synthetic-report.js') =
    await import('./__fixtures__/synthetic-report.js');

  type Case = {
    name: string;
    check: () => boolean;
    explain: () => string;
  };

  const r1 = verdictValidate(fixtures.reportPassWithOneSource);
  const r2 = verdictValidate(fixtures.reportNoGo);
  const r3 = verdictValidate(fixtures.reportAllMajorChecks);
  const r4 = verdictValidate(fixtures.reportAllDTier);
  const r5 = verdictValidate(fixtures.reportFundamentalCheck);

  const cases: Case[] = [
    {
      name: 'PASS-with-1-source → Gate 1 becomes INCONCLUSIVE',
      check: () =>
        r1.adjusted_report.gates[0]!.status === 'INCONCLUSIVE' &&
        r1.issues.some((i) => i.code === 'pass_insufficient_sources'),
      explain: () =>
        `gate1.status=${r1.adjusted_report.gates[0]!.status}, overall=${r1.adjusted_report.verdict.overall}`,
    },
    {
      name: 'NO-GO report stays NO-GO',
      check: () => r2.adjusted_report.verdict.overall === 'NO-GO',
      explain: () => `overall=${r2.adjusted_report.verdict.overall}`,
    },
    {
      name: 'All-Major checks → overall confidence Low',
      check: () =>
        r3.adjusted_report.verdict.overall_confidence === 'Low' &&
        r3.issues.some((i) => i.code === 'validation_check_major'),
      explain: () =>
        `confidence=${r3.adjusted_report.verdict.overall_confidence}, issues=${r3.issues.map((i) => i.code).join(',')}`,
    },
    {
      name: 'All-D-tier gate → INCONCLUSIVE override',
      check: () =>
        r4.adjusted_report.gates[1]!.status === 'INCONCLUSIVE' &&
        r4.issues.some((i) => i.code === 'gate_all_c_or_d_tier'),
      explain: () =>
        `gate2.status=${r4.adjusted_report.gates[1]!.status}`,
    },
    {
      name: 'Fundamental check → overall INCONCLUSIVE',
      check: () =>
        r5.adjusted_report.verdict.overall === 'INCONCLUSIVE' &&
        r5.issues.some((i) => i.code === 'validation_check_fundamental'),
      explain: () =>
        `overall=${r5.adjusted_report.verdict.overall}`,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const ok = c.check();
    console.error(`[T08 self-check] ${c.name}: ${ok ? 'PASS' : 'FAIL'} — ${c.explain()}`);
    if (!ok) failed++;
  }

  if (failed > 0) {
    console.error(`[T08 self-check] ${failed} case(s) failed`);
    process.exit(1);
  }
  console.error('[T08 self-check] all cases passed');
}
