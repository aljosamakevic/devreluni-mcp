/**
 * Zod schema mirroring the `ValidationReport` TypeScript types in `./types.ts`.
 *
 * Scope: STRUCTURE only. This schema rejects malformed JSON, missing fields,
 * wrong enum values, and shape violations the parser can mechanically detect.
 *
 * Out of scope (handled by downstream validators):
 *   - DOK layer separation enforcement → `structural-validator.ts` (T07)
 *   - Blank Spiky POV byte-match     → `structural-validator.ts` (T07)
 *   - Contradicting Evidence semantics → `structural-validator.ts` (T07)
 *   - PASS-requires-≥2-tier-B rule     → `verdict-validator.ts` (T08)
 *   - Validation-check decision matrix → `verdict-validator.ts` (T08)
 *
 * The schema is intentionally permissive about `unknown` bias values — the
 * verdict validator converts `unknown → vendor-funded` via `effectiveBias()`
 * at math time (spec §4 rule 4). Rejecting `unknown` at parse time would
 * force the LLM to lie; accepting it lets the math layer mechanically
 * downgrade.
 *
 * Spec refs: §4 (runtime requirement: every fact has tier+bias+url+fetched_at);
 * §5 (artifact structure); §1 mechanism 5 (blank POV).
 */

import { z } from 'zod';
import type { ZodIssue } from 'zod';
import type { ValidationReport } from './types.js';

// ──────────────────────────────────────────────────────────────────────────
// Primitive enums
// ──────────────────────────────────────────────────────────────────────────

const SourceTierSchema = z.enum(['S', 'A', 'B', 'C', 'D']);
const BiasFlagSchema = z.enum([
  'independent',
  'vendor-funded',
  'conflicted',
  'unknown',
]);
const GateStatusSchema = z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']);
const ConfidenceSchema = z.enum(['High', 'Medium', 'Low']);
const OverallVerdictSchema = z.enum([
  'GO',
  'NO-GO',
  'CONDITIONAL GO',
  'INCONCLUSIVE',
]);
const ValidationCheckOutcomeSchema = z.enum([
  'No issues',
  'Minor',
  'Major',
  'Fundamental',
]);
const ValidationCheckNameSchema = z.enum([
  'Source Quality Audit',
  'Counterargument Search',
  'Logic & Coherence Review',
]);
const AudienceSchema = z.enum(['B2B', 'B2C', 'B2B2C', 'dev_tools']);
const BuilderSchema = z.enum(['solo', 'small_team', 'funded']);
const GateNumberSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
const DokLayerNumberSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

// ──────────────────────────────────────────────────────────────────────────
// ToolSource — must match `src/types.ts` exactly. We redefine the zod schema
// here (rather than import) so the runtime contract is colocated with the
// rest of the report shape. Any drift will fail tsc on `ValidationReport`.
// ──────────────────────────────────────────────────────────────────────────

const ToolSourceSchema = z.object({
  url: z.string().min(1, 'source url required'),
  tier: SourceTierSchema,
  bias: BiasFlagSchema,
  fetched_at: z.string().min(1, 'fetched_at required'),
  contribution: z.string(),
});

// ──────────────────────────────────────────────────────────────────────────
// Mix dictionaries — exact key sets
// ──────────────────────────────────────────────────────────────────────────

const SourceMixSchema = z.object({
  S: z.number().int().nonnegative(),
  A: z.number().int().nonnegative(),
  B: z.number().int().nonnegative(),
  C: z.number().int().nonnegative(),
  D: z.number().int().nonnegative(),
});

const BiasMixSchema = z.object({
  independent: z.number().int().nonnegative(),
  'vendor-funded': z.number().int().nonnegative(),
  conflicted: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
});

// ──────────────────────────────────────────────────────────────────────────
// Section 1 — Header
// ──────────────────────────────────────────────────────────────────────────

const HeaderSchema = z.object({
  idea: z.string().min(1),
  audience: AudienceSchema,
  builder: BuilderSchema,
  generated_at: z.string().min(1),
  mcp_version: z.string().min(1),
  total_sources_consulted: z.number().int().nonnegative(),
  source_quality_mix: SourceMixSchema,
  bias_mix: BiasMixSchema,
});

// ──────────────────────────────────────────────────────────────────────────
// Section 2 — Verdict
// ──────────────────────────────────────────────────────────────────────────

const GateSummaryRowSchema = z.object({
  gate: GateNumberSchema,
  name: z.string().min(1),
  status: GateStatusSchema,
  reason: z.string().min(1),
});

const KillshotReasonSchema = z.object({
  reason: z.string().min(1),
  cited_source_urls: z.array(z.string().min(1)),
});

const VerdictSchema = z.object({
  overall: OverallVerdictSchema,
  overall_confidence: ConfidenceSchema,
  gate_summary: z.array(GateSummaryRowSchema).length(5, 'exactly 5 gate summary rows required'),
  killshots: z.array(KillshotReasonSchema),
});

// ──────────────────────────────────────────────────────────────────────────
// Section 3 — Gate reports (DOK 1→4)
// ──────────────────────────────────────────────────────────────────────────

const DOK1FactSchema = z.object({
  text: z.string().min(1),
  source: ToolSourceSchema,
});

const DOK3InsightSchema = z.object({
  text: z.string().min(1),
  // Spec §6.1 OPERATING RULE 2 — DOK 3 entries must be visibly labeled as
  // model judgment. The schema enforces the literal `true` value; the
  // renderer translates this into the ⚠️ marker.
  is_model_judgment: z.literal(true),
});

const DOK4VerdictSchema = z.object({
  status: GateStatusSchema,
  confidence: ConfidenceSchema,
  reasoning: z.string().min(1),
});

const ContradictingEvidenceSchema = z.object({
  text: z.string().min(1),
  source: ToolSourceSchema.nullable(),
});

const GateSourceMetaSchema = z.object({
  consulted: z.number().int().nonnegative(),
  tiers: SourceMixSchema,
  bias: BiasMixSchema,
});

const GateReportSchema = z.object({
  gate: GateNumberSchema,
  name: z.string().min(1),
  status: GateStatusSchema,
  confidence: ConfidenceSchema,
  // Every gate MUST have at least one DOK 1 fact (spec §5 Section 3). The
  // structural validator (T07) re-asserts this for clarity, but the schema
  // catches the trivial case here.
  dok1_facts: z.array(DOK1FactSchema).min(1, 'each gate requires ≥1 DOK 1 fact'),
  dok2_summary: z.string().min(1, 'DOK 2 summary required'),
  dok3_insights: z.array(DOK3InsightSchema).min(1, 'each gate requires ≥1 DOK 3 insight'),
  // Every gate must carry at least the "no contradicting evidence" sentinel
  // entry (spec §1 mechanism 3 + §6.1 Step 1e). T07 enforces sentinel text.
  contradicting_evidence: z.array(ContradictingEvidenceSchema).min(1, 'contradicting_evidence required (sentinel or entry)'),
  dok4_verdict: DOK4VerdictSchema,
  source_meta: GateSourceMetaSchema,
});

// ──────────────────────────────────────────────────────────────────────────
// Section 4 — Validation checks (exactly 3)
// ──────────────────────────────────────────────────────────────────────────

const ValidationCheckRowSchema = z.object({
  dimension: z.string().min(1),
  finding: z.string().min(1),
});

const ValidationCheckSchema = z.object({
  name: ValidationCheckNameSchema,
  rows: z.array(ValidationCheckRowSchema).min(1),
  outcome: ValidationCheckOutcomeSchema,
  notes: z.string(),
});

// ──────────────────────────────────────────────────────────────────────────
// Section 5 — Test cards
// ──────────────────────────────────────────────────────────────────────────

const TestCardSchema = z.object({
  id: z.string().min(1),
  belief: z.string().min(1),
  verification_method: z.string().min(1),
  metric: z.string().min(1),
  success_threshold: z.string().min(1),
  linked_gate: GateNumberSchema,
  cheapest_test: z.string().min(1),
});

// ──────────────────────────────────────────────────────────────────────────
// Section 6 — Spiky POV (structural only; byte-match is T07's job)
// ──────────────────────────────────────────────────────────────────────────

const SpikyPOVSchema = z.object({
  template: z.string().min(1),
});

// ──────────────────────────────────────────────────────────────────────────
// Section 7 — Source appendix
// ──────────────────────────────────────────────────────────────────────────

const SourceAppendixRowSchema = z.object({
  index: z.number().int().positive(),
  source: ToolSourceSchema,
  gates: z.array(GateNumberSchema),
  dok_layers: z.array(DokLayerNumberSchema),
});

// ──────────────────────────────────────────────────────────────────────────
// Section 8 — Methodology notes
// ──────────────────────────────────────────────────────────────────────────

const ToolCallRecordSchema = z.object({
  tool: z.string().min(1),
  args_summary: z.string(),
  succeeded: z.boolean(),
  failure_note: z.string().optional(),
});

const MethodologyNotesSchema = z.object({
  tool_calls: z.array(ToolCallRecordSchema),
  tool_calls_fired: z.number().int().nonnegative(),
  validation_rules_in_force: z.string().min(1),
  disclaimer: z.string().min(1),
});

// ──────────────────────────────────────────────────────────────────────────
// Top-level ValidationReport schema
// ──────────────────────────────────────────────────────────────────────────

export const ValidationReportSchema: z.ZodType<ValidationReport> = z.object({
  header: HeaderSchema,
  verdict: VerdictSchema,
  gates: z.array(GateReportSchema).length(5, 'exactly 5 gates required'),
  validation_checks: z
    .array(ValidationCheckSchema)
    .length(3, 'exactly 3 validation checks required'),
  test_cards: z.array(TestCardSchema),
  spiky_pov: SpikyPOVSchema,
  source_appendix: z.array(SourceAppendixRowSchema),
  methodology_notes: MethodologyNotesSchema,
}) as z.ZodType<ValidationReport>;

// ──────────────────────────────────────────────────────────────────────────
// Safe parse helper — never throws.
// ──────────────────────────────────────────────────────────────────────────

export type ParseResult =
  | { ok: true; report: ValidationReport }
  | { ok: false; issues: ZodIssue[] };

/**
 * Parse a raw JSON object (already JSON.parsed by the caller) into a
 * `ValidationReport`. Returns a discriminated-union result; never throws.
 *
 * Callers handle the failure branch by surfacing schema issues to the
 * `finalize_validation_report` tool's `confidence_note` (T09b).
 */
export function parseValidationReport(json: unknown): ParseResult {
  const result = ValidationReportSchema.safeParse(json);
  if (result.success) {
    return { ok: true, report: result.data };
  }
  return { ok: false, issues: result.error.issues };
}
