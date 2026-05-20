/**
 * finalize_validation_report — server-side pipeline that turns the LLM's
 * JSON `ValidationReport` into the final, validated markdown artifact.
 *
 * This is the ONLY path that emits the spec §5 idea-validation report.
 * The `validate_idea` prompt (T09c) instructs the LLM to:
 *   1. emit a JSON-only `ValidationReport`,
 *   2. call this tool with that JSON,
 *   3. relay the returned markdown verbatim.
 *
 * Pipeline (abort-on-fundamental):
 *   1. JSON.parse → on throw: status=validation_failed, stage=parse.
 *   2. parseValidationReport (zod) → on !ok: stage=schema.
 *   3. structuralValidate → if any fundamental: stage=structural.
 *   4. verdictValidate → mutates verdicts; collect issues.
 *   5. Combine non-fundamental issues from steps 3+4.
 *   6. renderReport(adjusted_report) → markdown.
 *   7. Build adjustments_made by gate-by-gate diff.
 *
 * On failure: NO markdown body. The LLM is instructed (T09c) to retry once
 * on a structured failure.
 *
 * Spec refs: §3, §4, §5, §6.1 Step 7, §11 anti-patterns 1 + 5.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ZodIssue } from 'zod';

import { parseValidationReport } from '../validation/schema.js';
import { structuralValidate } from '../validation/structural-validator.js';
import { verdictValidate } from '../validation/verdict-validator.js';
import { renderReport } from '../validation/renderer.js';
import type {
  GateStatus,
  ValidationIssue,
  ValidationReport,
} from '../validation/types.js';

// ──────────────────────────────────────────────────────────────────────────
// Result envelope
// ──────────────────────────────────────────────────────────────────────────

type FailStage = 'parse' | 'schema' | 'structural';

interface ParseFailureIssue {
  severity: 'fundamental';
  code: 'invalid_json';
  message: string;
}

interface SuccessResult {
  status: 'ok';
  markdown: string;
  issues: ValidationIssue[];
  adjustments_made: string[];
}

interface FailureResult {
  status: 'validation_failed';
  stage: FailStage;
  issues: ParseFailureIssue[] | ZodIssue[] | ValidationIssue[];
  /** Present only for structural-stage failures so the LLM can self-correct. */
  partial_report?: ValidationReport;
}

type FinalizeResult = SuccessResult | FailureResult;

// ──────────────────────────────────────────────────────────────────────────
// Adjustment diff — surfaces verdict changes the validator forced.
// ──────────────────────────────────────────────────────────────────────────

function gateName(report: ValidationReport, gateNumber: number): string {
  const g = report.gates.find((x) => x.gate === gateNumber);
  return g?.name ?? `Gate ${gateNumber}`;
}

function diffAdjustments(
  before: ValidationReport,
  after: ValidationReport
): string[] {
  const lines: string[] = [];

  // Per-gate status / confidence changes.
  for (const afterGate of after.gates) {
    const beforeGate = before.gates.find((g) => g.gate === afterGate.gate);
    if (!beforeGate) continue;
    if (beforeGate.status !== afterGate.status) {
      const beforeStatus: GateStatus = beforeGate.status;
      const afterStatus: GateStatus = afterGate.status;
      lines.push(
        `Gate ${afterGate.gate} (${gateName(after, afterGate.gate)}): status ${beforeStatus} → ${afterStatus}`
      );
    }
    if (beforeGate.confidence !== afterGate.confidence) {
      lines.push(
        `Gate ${afterGate.gate} (${gateName(after, afterGate.gate)}): confidence ${beforeGate.confidence} → ${afterGate.confidence}`
      );
    }
  }

  // Overall verdict / confidence changes.
  if (before.verdict.overall !== after.verdict.overall) {
    lines.push(
      `Overall verdict: ${before.verdict.overall} → ${after.verdict.overall}`
    );
  }
  if (
    before.verdict.overall_confidence !== after.verdict.overall_confidence
  ) {
    lines.push(
      `Overall confidence: ${before.verdict.overall_confidence} → ${after.verdict.overall_confidence}`
    );
  }

  return lines;
}

// ──────────────────────────────────────────────────────────────────────────
// Core pipeline (pure — exported for tests/self-check if needed later)
// ──────────────────────────────────────────────────────────────────────────

export function finalizeValidationReport(reportJson: string): FinalizeResult {
  // Step 1 — JSON parse.
  let parsed: unknown;
  try {
    parsed = JSON.parse(reportJson);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'validation_failed',
      stage: 'parse',
      issues: [
        {
          severity: 'fundamental',
          code: 'invalid_json',
          message,
        },
      ],
    };
  }

  // Step 2 — schema parse.
  const schemaResult = parseValidationReport(parsed);
  if (!schemaResult.ok) {
    return {
      status: 'validation_failed',
      stage: 'schema',
      issues: schemaResult.issues,
    };
  }
  const report = schemaResult.report;

  // Step 3 — structural validation.
  const structuralIssues = structuralValidate(report);
  const hasFundamental = structuralIssues.some(
    (i) => i.severity === 'fundamental'
  );
  if (hasFundamental) {
    return {
      status: 'validation_failed',
      stage: 'structural',
      issues: structuralIssues,
      partial_report: report,
    };
  }

  // Step 4 — verdict validation (mutates verdicts on a deep clone).
  const { adjusted_report, issues: verdictIssues } = verdictValidate(report);

  // Step 5 — combine non-fundamental issues. (No fundamentals from step 3
  // could have survived the early-return above. Verdict validation can emit
  // a fundamental for `validation_check_fundamental`; we surface it but do
  // NOT block rendering — the verdict has already been overridden to
  // INCONCLUSIVE per spec §3, and the renderer is the canonical artifact.)
  const allIssues: ValidationIssue[] = [
    ...structuralIssues, // major/minor only — fundamentals returned above
    ...verdictIssues,
  ];

  // Step 6 — render.
  const markdown = renderReport(adjusted_report);

  // Step 7 — adjustments_made diff.
  const adjustments_made = diffAdjustments(report, adjusted_report);

  return {
    status: 'ok',
    markdown,
    issues: allIssues,
    adjustments_made,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// MCP tool registration
// ──────────────────────────────────────────────────────────────────────────

export function registerFinalizeValidationReport(server: McpServer): void {
  server.registerTool(
    'finalize_validation_report',
    {
      description:
        'Finalize a ValidationReport. Pass the JSON you constructed in `validate_idea`. Returns the validated markdown artifact, or a `validation_failed` error with the specific issues to fix. **This is the ONLY way to emit the final validation artifact — do not output markdown directly.**',
      inputSchema: {
        report_json: z
          .string()
          .describe(
            'The full ValidationReport as a JSON string (matching resource://report-schema).'
          ),
      },
    },
    async ({ report_json }) => {
      const result = finalizeValidationReport(report_json);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
