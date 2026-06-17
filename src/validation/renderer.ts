/**
 * T09a — Deterministic markdown renderer for `ValidationReport`.
 *
 * Pure function: same `ValidationReport` in → byte-identical markdown out. No
 * LLM in the loop, no I/O, no clock reads, no randomness. The structure mirrors
 * spec §5 Sections 1–8 in order.
 *
 * Defense-in-depth contract (closes H2 / bypass-the-blank-POV risk):
 *   The Spiky POV section is rendered ALWAYS from the canonical
 *   `SPIKY_POV_BLANK_TEMPLATE` constant. The `report.spiky_pov.template` field
 *   is intentionally ignored. Even if the LLM somehow injected POV content
 *   that slipped through T07's structural validator, the renderer refuses to
 *   emit it. T07 enforces a byte-for-byte match upstream; T09a enforces it
 *   again at the output boundary.
 *
 * GitHub-flavored markdown only — no HTML, no Mermaid — so the artifact pastes
 * cleanly into Notion / Linear / Slack as the spec requires.
 */

import type {
  ContradictingEvidence,
  DOK1Fact,
  DOK3Insight,
  GateReport,
  GateSummaryRow,
  KillshotReason,
  MethodologyNotes,
  SourceAppendixRow,
  TestCard,
  ValidationCheck,
  ValidationReport,
  Verdict,
} from './types.js';
import type { ToolSource } from '../types.js';
import {
  CONTRADICTING_EVIDENCE_NONE_SENTINEL,
  SPIKY_POV_BLANK_TEMPLATE,
} from './constants.js';

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Render a `ValidationReport` to a deterministic markdown string.
 *
 * Pure: no I/O, no clock, no `Math.random`. Output is byte-stable across runs
 * given identical input — required so that snapshot tests and the calibration
 * harness (T20) can diff outputs over time.
 */
export function renderReport(report: ValidationReport): string {
  const parts: string[] = [
    renderHeader(report),
    renderVerdict(report.verdict),
    renderEvidenceReport(report.gates),
    renderValidationChecks(report.validation_checks),
    renderTestCards(report.test_cards),
    renderSpikyPOV(),
    renderSourceAppendix(report.source_appendix),
    renderMethodologyNotes(report.methodology_notes),
  ];
  // Single trailing newline. Joining with a blank line between sections.
  return parts.join('\n\n') + '\n';
}

// ──────────────────────────────────────────────────────────────────────────
// Section 1: Header
// ──────────────────────────────────────────────────────────────────────────

function renderHeader(report: ValidationReport): string {
  const h = report.header;
  const tiers = h.source_quality_mix;
  const bias = h.bias_mix;
  return [
    '## Section 1: Header',
    '',
    `Idea: ${h.idea}`,
    `Framing: audience=${h.audience}, builder=${h.builder}`,
    `Generated: ${h.generated_at}`,
    `MCP version: ${h.mcp_version}`,
    `Total sources consulted: ${h.total_sources_consulted}`,
    `Source quality mix: S:${tiers.S} A:${tiers.A} B:${tiers.B} C:${tiers.C} D:${tiers.D}`,
    `Bias mix: independent:${bias.independent} vendor-funded:${bias['vendor-funded']} conflicted:${bias.conflicted} unknown:${bias.unknown}`,
  ].join('\n');
}

// ──────────────────────────────────────────────────────────────────────────
// Section 2: Verdict (above the fold)
// ──────────────────────────────────────────────────────────────────────────

function renderVerdict(v: Verdict): string {
  const lines: string[] = [
    '## Section 2: Verdict',
    '',
    `**${v.overall}**`,
    '',
    '| Gate | Name | Status | Reason |',
    '| --- | --- | --- | --- |',
  ];
  for (const row of v.gate_summary) {
    lines.push(
      `| ${row.gate} | ${escapeCell(row.name)} | ${statusGlyph(row.status)} | ${escapeCell(row.reason)} |`
    );
  }

  // Phase 10 — never silently drop killshots. On NO-GO they ARE the
  // verdict-determining killshots (unchanged heading). When the verdict was
  // softened by the mechanical rules but the model still flagged killshots,
  // surface them under "Key risks flagged" so the existential reasoning is
  // not lost (the previous behavior hid them entirely on any non-NO-GO verdict).
  if (v.killshots.length > 0) {
    const heading =
      v.overall === 'NO-GO'
        ? '### Killshot reasons'
        : '### Key risks flagged (not verdict-determining)';
    lines.push('', heading, '');
    for (const k of v.killshots) {
      lines.push(`- ${renderKillshot(k)}`);
    }
  }

  lines.push('', `Overall confidence: ${v.overall_confidence}`);
  return lines.join('\n');
}

function statusGlyph(s: 'PASS' | 'FAIL' | 'INCONCLUSIVE'): string {
  if (s === 'PASS') return '✅ PASS';
  if (s === 'FAIL') return '❌ FAIL';
  return '⚠️ INCONCLUSIVE';
}

function renderKillshot(k: KillshotReason): string {
  const cites = k.cited_source_urls.length > 0
    ? ' (' + k.cited_source_urls.map((u) => `<${u}>`).join(', ') + ')'
    : '';
  return `${escapeInline(k.reason)}${cites}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Section 3: Evidence Report — DOK 1..4 per gate
// ──────────────────────────────────────────────────────────────────────────

function renderEvidenceReport(gates: GateReport[]): string {
  const lines: string[] = ['## Section 3: Evidence Report', ''];
  for (const g of gates) {
    lines.push(renderGate(g));
    lines.push('');
  }
  // Strip the trailing empty string before joining to avoid a triple newline.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function renderGate(g: GateReport): string {
  const lines: string[] = [
    `### Gate ${g.gate}: ${g.name}`,
    '',
    `Status: ${g.status}`,
    `Confidence: ${g.confidence}`,
    '',
    '#### DOK 1 — Facts (raw, sourced)',
    '',
  ];
  if (g.dok1_facts.length === 0) {
    lines.push('- (no facts recorded)');
  } else {
    for (const f of g.dok1_facts) lines.push(renderDok1Fact(f));
  }

  lines.push('', '#### DOK 2 — Summary (synthesis, no interpretation)', '', g.dok2_summary);

  lines.push('', '#### DOK 3 — Insights (interpretation — MODEL JUDGMENT, NOT FACT) ⚠️', '');
  if (g.dok3_insights.length === 0) {
    lines.push('- (no insights recorded)');
  } else {
    for (const i of g.dok3_insights) lines.push(renderDok3Insight(i));
  }

  lines.push('', '#### Contradicting Evidence', '');
  lines.push(renderContradictingEvidence(g.contradicting_evidence));

  lines.push(
    '',
    '#### DOK 4 — Gate Verdict',
    '',
    `${g.dok4_verdict.status} (confidence: ${g.dok4_verdict.confidence}) because ${g.dok4_verdict.reasoning}`
  );

  const meta = g.source_meta;
  lines.push(
    '',
    '#### Source meta',
    '',
    `Consulted: ${meta.consulted} | Tiers: S:${meta.tiers.S} A:${meta.tiers.A} B:${meta.tiers.B} C:${meta.tiers.C} D:${meta.tiers.D} | Bias: indep:${meta.bias.independent} vendor:${meta.bias['vendor-funded']} conflicted:${meta.bias.conflicted} unknown:${meta.bias.unknown}`
  );

  return lines.join('\n');
}

/** Spec §4 runtime requirement: every DOK 1 fact carries provenance inline. */
function renderDok1Fact(f: DOK1Fact): string {
  const s = f.source;
  return `- ${escapeInline(f.text)} — Source: ${s.url} | Tier: ${s.tier} | Bias: ${s.bias} | Fetched: ${s.fetched_at}`;
}

function renderDok3Insight(i: DOK3Insight): string {
  return `- ⚠️ ${escapeInline(i.text)}`;
}

function renderContradictingEvidence(entries: ContradictingEvidence[]): string {
  // If the array is exactly the single "none found" sentinel, emit it verbatim.
  if (
    entries.length === 1 &&
    entries[0]!.text === CONTRADICTING_EVIDENCE_NONE_SENTINEL &&
    entries[0]!.source === null
  ) {
    return CONTRADICTING_EVIDENCE_NONE_SENTINEL;
  }
  // Otherwise render each entry as a bullet, with provenance when present.
  const out: string[] = [];
  for (const e of entries) {
    if (e.source) {
      const s = e.source;
      out.push(
        `- ${escapeInline(e.text)} — Source: ${s.url} | Tier: ${s.tier} | Bias: ${s.bias} | Fetched: ${s.fetched_at}`
      );
    } else {
      out.push(`- ${escapeInline(e.text)}`);
    }
  }
  return out.join('\n');
}

// ──────────────────────────────────────────────────────────────────────────
// Section 4: Validation Checks
// ──────────────────────────────────────────────────────────────────────────

function renderValidationChecks(checks: ValidationCheck[]): string {
  const lines: string[] = ['## Section 4: Validation Checks', ''];
  for (const c of checks) {
    lines.push(`### ${c.name}`, '');
    lines.push('| Dimension | Finding |', '| --- | --- |');
    if (c.rows.length === 0) {
      lines.push('| (no dimensions) | — |');
    } else {
      for (const r of c.rows) {
        lines.push(`| ${escapeCell(r.dimension)} | ${escapeCell(r.finding)} |`);
      }
    }
    lines.push('', `Outcome: ${c.outcome}`);
    if (c.notes && c.notes.length > 0) {
      lines.push('', `Notes: ${escapeInline(c.notes)}`);
    }
    lines.push('');
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────────────
// Section 5: What Would Change This — Strategyzer Test Cards
// ──────────────────────────────────────────────────────────────────────────

function renderTestCards(cards: TestCard[]): string {
  const lines: string[] = ['## Section 5: What Would Change This', ''];
  if (cards.length === 0) {
    lines.push('_No test cards recorded._');
    return lines.join('\n');
  }
  for (const c of cards) {
    lines.push(
      `### ${c.id}: ${escapeInline(c.belief)}`,
      '',
      `- We believe: ${escapeInline(c.belief)}`,
      `- To verify, we will: ${escapeInline(c.verification_method)}`,
      `- We measure: ${escapeInline(c.metric)}`,
      `- We're right if: ${escapeInline(c.success_threshold)}`,
      `- Linked to gate: ${c.linked_gate}`,
      `- Cheapest test: ${escapeInline(c.cheapest_test)}`,
      ''
    );
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────────────
// Section 6: Your Spiky POV — ALWAYS BLANK (defense in depth)
// ──────────────────────────────────────────────────────────────────────────

function renderSpikyPOV(): string {
  // CRITICAL: do NOT read `report.spiky_pov`. The renderer's contract is to
  // emit the canonical blank template verbatim, regardless of input. This
  // closes H2 / bypass-the-POV-block even if T07 missed something.
  return ['## Section 6: Your Spiky POV', '', SPIKY_POV_BLANK_TEMPLATE.trimEnd()].join('\n');
}

// ──────────────────────────────────────────────────────────────────────────
// Section 7: Source Appendix
// ──────────────────────────────────────────────────────────────────────────

function renderSourceAppendix(rows: SourceAppendixRow[]): string {
  const lines: string[] = ['## Section 7: Source Appendix', ''];
  if (rows.length === 0) {
    lines.push('_No sources recorded._');
    return lines.join('\n');
  }
  for (const r of rows) {
    lines.push(renderSourceAppendixRow(r));
  }
  return lines.join('\n');
}

function renderSourceAppendixRow(r: SourceAppendixRow): string {
  const gates = r.gates.length > 0 ? r.gates.join(',') : '—';
  const doks = r.dok_layers.length > 0 ? r.dok_layers.join(',') : '—';
  return `${r.index}. ${formatSource(r.source)} | Gates: ${gates} | DOK: ${doks}`;
}

function formatSource(s: ToolSource): string {
  return `${s.url} — Tier: ${s.tier} | Bias: ${s.bias} | Fetched: ${s.fetched_at} | Contribution: ${escapeInline(s.contribution)}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Section 8: Methodology Notes (footer)
// ──────────────────────────────────────────────────────────────────────────

function renderMethodologyNotes(m: MethodologyNotes): string {
  const lines: string[] = [
    '## Section 8: Methodology Notes',
    '',
    // Structured line consumed by T19/T20 calibration. Spec §5 Section 8 +
    // plan T09a acceptance: grep must return exactly 1.
    `Tool calls fired: ${m.tool_calls_fired}`,
    '',
    '### Tools fired',
    '',
  ];
  if (m.tool_calls.length === 0) {
    lines.push('- (no tool calls recorded)');
  } else {
    for (const t of m.tool_calls) {
      const status = t.succeeded ? 'ok' : 'FAILED';
      const reason = t.succeeded ? '' : ` — ${escapeInline(t.failure_note ?? 'no reason given')}`;
      lines.push(`- ${t.tool}(${escapeInline(t.args_summary)}) → ${status}${reason}`);
    }
  }

  // Also surface failed tools separately (spec §5 Section 8 lists them as a
  // distinct bullet category — useful for the calibration harness).
  const failed = m.tool_calls.filter((t) => !t.succeeded);
  lines.push('', '### Tools that failed or returned no results', '');
  if (failed.length === 0) {
    lines.push('- None.');
  } else {
    for (const t of failed) {
      lines.push(`- ${t.tool} — ${escapeInline(t.failure_note ?? 'no reason given')}`);
    }
  }

  lines.push('', '### Validation rules in force', '', m.validation_rules_in_force);
  lines.push('', '### Disclaimer', '', `_${m.disclaimer}_`);
  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/** Escape pipes/newlines inside a markdown table cell. */
function escapeCell(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Light escaping for inline text outside tables. Markdown is permissive; we
 * only normalize line endings to avoid accidental layout breakage.
 */
function escapeInline(s: string): string {
  return s.replace(/\r\n/g, '\n');
}

// ──────────────────────────────────────────────────────────────────────────
// Self-check — runs only when this file is invoked directly
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
  const fixtures: typeof import('./__fixtures__/synthetic-report.js') =
    await import('./__fixtures__/synthetic-report.js');
  const output = renderReport(fixtures.validReport);

  const expectedHeadings = [
    '## Section 1: Header',
    '## Section 2: Verdict',
    '## Section 3: Evidence Report',
    '## Section 4: Validation Checks',
    '## Section 5: What Would Change This',
    '## Section 6: Your Spiky POV',
    '## Section 7: Source Appendix',
    '## Section 8: Methodology Notes',
  ];

  const failures: string[] = [];

  // Assertion 1: 8 section headings present, in order.
  let cursor = -1;
  for (const heading of expectedHeadings) {
    const idx = output.indexOf(heading, cursor + 1);
    if (idx === -1) {
      failures.push(`missing heading: ${heading}`);
      break;
    }
    if (idx <= cursor) {
      failures.push(`out-of-order heading: ${heading}`);
      break;
    }
    cursor = idx;
  }

  // Assertion 2: blank POV template emitted verbatim.
  if (!output.includes(SPIKY_POV_BLANK_TEMPLATE.trimEnd())) {
    failures.push('SPIKY_POV_BLANK_TEMPLATE not present verbatim');
  }

  // Assertion 3: zero `[object Object]` leaks.
  const leakCount = (output.match(/\[object Object\]/g) ?? []).length;
  if (leakCount !== 0) {
    failures.push(`[object Object] leak count = ${leakCount}`);
  }

  // Bonus: defense-in-depth — render a report with populated POV and confirm
  // the renderer still emits the blank template.
  const fixturesAny = fixtures as unknown as {
    reportFilledPov: import('./types.js').ValidationReport;
  };
  const filledOutput = renderReport(fixturesAny.reportFilledPov);
  if (!filledOutput.includes(SPIKY_POV_BLANK_TEMPLATE.trimEnd())) {
    failures.push('defense-in-depth: filled-POV input did not emit blank template');
  }
  if (filledOutput.includes('I think this idea is great because the LLM said so.')) {
    failures.push('defense-in-depth: renderer leaked LLM-injected POV content');
  }

  // Bonus: `Tool calls fired:` appears exactly once.
  const tcFiredMatches = (output.match(/Tool calls fired:/g) ?? []).length;
  if (tcFiredMatches !== 1) {
    failures.push(`Tool calls fired: appears ${tcFiredMatches} times (expected 1)`);
  }

  if (failures.length === 0) {
    console.error(
      `[T09a self-check] PASS — ${expectedHeadings.length} sections, POV template intact, no [object Object]`
    );
  } else {
    for (const f of failures) console.error(`[T09a self-check] FAIL — ${f}`);
    process.exit(1);
  }
}
