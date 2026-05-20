/**
 * ValidationReport types — typed mirror of the spec §5 Idea Validation Report
 * artifact.
 *
 * The master `validate_idea` prompt emits a JSON object matching this shape.
 * The server-side pipeline (parse → structural validate → verdict validate →
 * render) then turns it into the pasteable markdown artifact.
 *
 * Why types-first: the spec §1 anti-bias mechanisms (DOK layer separation,
 * Contradicting Evidence per gate, blank Spiky POV, source-count thresholds,
 * Validation-Check decision matrix) are encoded structurally here so the
 * downstream validators can check them mechanically rather than trusting the
 * LLM to have followed prompt instructions.
 *
 * Every section in spec §5 (1–8) maps to a field on `ValidationReport` below.
 */

import type { ToolSource } from '../types.js';

// ──────────────────────────────────────────────────────────────────────────
// Status / verdict enums
// ──────────────────────────────────────────────────────────────────────────

/** Gate-level verdict — DOK 4 outcome. Spec §3. */
export type GateStatus = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

/** Confidence level — per-gate and overall. Spec §3. */
export type Confidence = 'High' | 'Medium' | 'Low';

/** Overall verdict from fail-2 math + override matrix. Spec §3. */
export type OverallVerdict = 'GO' | 'NO-GO' | 'CONDITIONAL GO' | 'INCONCLUSIVE';

/** Validation-check outcome. Spec §5 Section 4 + §3 decision matrix. */
export type ValidationCheckOutcome =
  | 'No issues'
  | 'Minor'
  | 'Major'
  | 'Fundamental';

/** The 3 mandatory audit checks. Spec §5 Section 4. */
export type ValidationCheckName =
  | 'Source Quality Audit'
  | 'Counterargument Search'
  | 'Logic & Coherence Review';

/** Audience framing. Mirrors `validate_idea` prompt arg. Spec §6.1. */
export type Audience = 'B2B' | 'B2C' | 'B2B2C' | 'dev_tools';

/** Builder framing. Spec §6.1. */
export type Builder = 'solo' | 'small_team' | 'funded';

// ──────────────────────────────────────────────────────────────────────────
// Section 1: Header block (spec §5 Section 1)
// ──────────────────────────────────────────────────────────────────────────

export interface SourceMix {
  S: number;
  A: number;
  B: number;
  C: number;
  D: number;
}

export interface BiasMix {
  independent: number;
  'vendor-funded': number;
  conflicted: number;
  unknown: number;
}

export interface Header {
  idea: string;
  audience: Audience;
  builder: Builder;
  generated_at: string; // ISO timestamp
  mcp_version: string; // semver — set by the renderer/finalize tool
  total_sources_consulted: number;
  source_quality_mix: SourceMix;
  bias_mix: BiasMix;
}

// ──────────────────────────────────────────────────────────────────────────
// Section 2: Verdict (above the fold) (spec §5 Section 2)
// ──────────────────────────────────────────────────────────────────────────

/** One row of the 5-gate summary table at the top of the report. */
export interface GateSummaryRow {
  /** Gate number 1–5. */
  gate: 1 | 2 | 3 | 4 | 5;
  /** Display name e.g. "Direct Competitor Scan". */
  name: string;
  status: GateStatus;
  /** One-line reason. */
  reason: string;
}

/** Killshot reason — used when overall verdict is NO-GO. Spec §5 Section 2. */
export interface KillshotReason {
  /** Human-readable claim, terse. */
  reason: string;
  /** URLs of the cited DOK 1 facts backing this killshot. */
  cited_source_urls: string[];
}

export interface Verdict {
  overall: OverallVerdict;
  overall_confidence: Confidence;
  gate_summary: GateSummaryRow[]; // length 5
  /** Present when overall is NO-GO. Spec §5 Section 2 "Killshot reasons". */
  killshots: KillshotReason[];
}

// ──────────────────────────────────────────────────────────────────────────
// Section 3: Evidence Report — DOK 1→4 per gate (spec §5 Section 3)
// ──────────────────────────────────────────────────────────────────────────

/** A single DOK 1 fact — raw, objective, sourced. Spec §4 runtime requirement. */
export interface DOK1Fact {
  /** Objective claim — no interpretation. */
  text: string;
  /** Source provenance — reuses the tool-layer `ToolSource` shape verbatim. */
  source: ToolSource;
}

/** A DOK 3 insight — explicit model judgment, labeled. Spec §5 + §6.1 rule 2. */
export interface DOK3Insight {
  /** The insight text. */
  text: string;
  /**
   * True iff this is model interpretation (not a fact). Spec §6.1 OPERATING
   * RULE 2 requires DOK 3 entries to be visibly labeled as ⚠️ model judgment.
   */
  is_model_judgment: true;
}

/** DOK 4 verdict block per gate. Spec §3 + §5. */
export interface DOK4Verdict {
  status: GateStatus;
  confidence: Confidence;
  /** Reasoning connecting DOK 3 to gate criteria. Spec §5 Section 3. */
  reasoning: string;
}

/**
 * Contradicting Evidence entry per gate. Spec §1 mechanism 3 + §6.1 Step 1e.
 *
 * If no counter-evidence was surfaced, the gate's `contradicting_evidence`
 * array MUST contain a single entry whose `text` equals
 * `CONTRADICTING_EVIDENCE_NONE_SENTINEL`.
 */
export interface ContradictingEvidence {
  /** The counter-claim text — or the canonical "none found" sentinel. */
  text: string;
  /**
   * Source backing the counter-claim. `null` only when `text` is the
   * "none found" sentinel string.
   */
  source: ToolSource | null;
}

/** Per-gate source-mix breakdown — rendered into the gate's footer. */
export interface GateSourceMeta {
  consulted: number;
  tiers: SourceMix;
  bias: BiasMix;
}

/** A full DOK 1→4 gate block + contradicting-evidence + source meta. */
export interface GateReport {
  gate: 1 | 2 | 3 | 4 | 5;
  name: string;
  /**
   * Gate status — may be overwritten by the verdict validator (T08) when
   * source-count or decision-matrix rules force a downgrade.
   */
  status: GateStatus;
  confidence: Confidence;
  /** DOK 1 — raw sourced facts. Spec §5 Section 3. Must be non-empty. */
  dok1_facts: DOK1Fact[];
  /** DOK 2 — plain restatement, no interpretation. */
  dok2_summary: string;
  /** DOK 3 — labeled model judgment. */
  dok3_insights: DOK3Insight[];
  /** Contradicting evidence block. At least the sentinel entry. */
  contradicting_evidence: ContradictingEvidence[];
  /** DOK 4 — gate verdict + reasoning. */
  dok4_verdict: DOK4Verdict;
  /** Source-mix footer. */
  source_meta: GateSourceMeta;
}

// ──────────────────────────────────────────────────────────────────────────
// Section 4: Validation Checks (spec §5 Section 4)
// ──────────────────────────────────────────────────────────────────────────

/** One row inside a validation check table. */
export interface ValidationCheckRow {
  /** Row label e.g. "Authority", "Recency". */
  dimension: string;
  /** Short finding for this dimension. */
  finding: string;
}

/** A single validation check — Source Quality / Counterargument / Logic. */
export interface ValidationCheck {
  name: ValidationCheckName;
  rows: ValidationCheckRow[];
  outcome: ValidationCheckOutcome;
  /** Free-text caveat surfaced when outcome != 'No issues'. */
  notes: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Section 5: What Would Change This — Test Cards (spec §5 Section 5)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Strategyzer Test Card format. Spec §5 Section 5 / §6.1 Step 5.
 *
 * `cheapest_test` MUST be a sub-MVP — landing page, fake-door, 5 interviews,
 * scraping, concierge — never "build the MVP" (spec §6.1 Step 5).
 */
export interface TestCard {
  /** H1, H2, …  Stable identifier. */
  id: string;
  /** "We believe …" — the testable claim. */
  belief: string;
  /** "To verify, we will …" — test method. */
  verification_method: string;
  /** "We measure …" — metric. */
  metric: string;
  /** "We're right if …" — success threshold. */
  success_threshold: string;
  /** Which gate this hypothesis attacks. */
  linked_gate: 1 | 2 | 3 | 4 | 5;
  /** Cheapest sub-MVP test. NEVER "build the MVP". */
  cheapest_test: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Section 6: Your Spiky POV (spec §5 Section 6) — BLANK by design
// ──────────────────────────────────────────────────────────────────────────

/**
 * The Spiky POV section is rendered from a constant template (see
 * `structural-validator.ts` → `SPIKY_POV_BLANK_TEMPLATE`). The model MUST emit
 * the canonical blank template verbatim; the structural validator enforces a
 * byte-for-byte match.
 *
 * Spec §1 mechanism 5 + §5 Section 6 + Appendix B(4).
 */
export interface SpikyPOV {
  /** The full template string. Must equal SPIKY_POV_BLANK_TEMPLATE. */
  template: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Section 7: Source Appendix (spec §5 Section 7)
// ──────────────────────────────────────────────────────────────────────────

/** One numbered row of the Source Appendix. */
export interface SourceAppendixRow {
  /** 1-based ordinal — matches `[N]` citations in DOK 1 facts. */
  index: number;
  source: ToolSource;
  /** Which gate(s) used this source. */
  gates: Array<1 | 2 | 3 | 4 | 5>;
  /** Which DOK layer(s) within those gates referenced it. */
  dok_layers: Array<1 | 2 | 3 | 4>;
}

// ──────────────────────────────────────────────────────────────────────────
// Section 8: Methodology Notes (spec §5 Section 8)
// ──────────────────────────────────────────────────────────────────────────

export interface ToolCallRecord {
  /** snake_case tool name as registered in `src/index.ts`. */
  tool: string;
  /** Stringified arguments for traceability. */
  args_summary: string;
  /** `true` if the tool returned usable data; `false` if it failed/empty. */
  succeeded: boolean;
  /** Reason if `succeeded === false`. */
  failure_note?: string;
}

export interface MethodologyNotes {
  tool_calls: ToolCallRecord[];
  /**
   * The mandatory `Tool calls fired: N` structured line (consumed by the
   * Fomi calibration script T20). Captured here so the renderer can emit it
   * deterministically.
   */
  tool_calls_fired: number;
  /** Plain-language summary of validation rules in force. */
  validation_rules_in_force: string;
  /**
   * Spec-mandated disclaimer: "This is a decision aid, not a verdict — final
   * call is yours."
   */
  disclaimer: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Top-level Idea Validation Report (spec §5 — all 8 sections)
// ──────────────────────────────────────────────────────────────────────────

export interface ValidationReport {
  /** Section 1. */
  header: Header;
  /** Section 2. */
  verdict: Verdict;
  /** Section 3 — exactly 5 gates in order 1..5. */
  gates: GateReport[];
  /** Section 4 — exactly 3 audit checks. */
  validation_checks: ValidationCheck[];
  /** Section 5. */
  test_cards: TestCard[];
  /** Section 6 — must be blank template. */
  spiky_pov: SpikyPOV;
  /** Section 7. */
  source_appendix: SourceAppendixRow[];
  /** Section 8. */
  methodology_notes: MethodologyNotes;
}

// ──────────────────────────────────────────────────────────────────────────
// Validator-side shared types
// ──────────────────────────────────────────────────────────────────────────

/**
 * Issue severity for both structural (T07) and verdict (T08) validators.
 *
 * - `fundamental` — blocks rendering; triggers verdict override to
 *   INCONCLUSIVE (spec §3 decision matrix + §11 anti-pattern 5).
 * - `major` — degrades overall confidence to Low (spec §3).
 * - `minor` — caveat only.
 */
export type IssueSeverity = 'fundamental' | 'major' | 'minor';

/** Validation issue shared by structural + verdict validators. */
export interface ValidationIssue {
  severity: IssueSeverity;
  /** Stable machine-readable code, e.g. `dok3_missing`, `spiky_pov_violation`. */
  code: string;
  /** Human-readable explanation. */
  message: string;
  /** Where the violation lives, e.g. `gates[2].dok3_insights`. */
  location: string;
}
