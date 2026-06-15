export interface ToolSource {
  url: string;
  tier: 'S' | 'A' | 'B' | 'C' | 'D';
  bias: 'independent' | 'vendor-funded' | 'conflicted' | 'unknown';
  fetched_at: string;
  contribution: string;
}

/**
 * Phase 09 — tight enum of failure causes a tool can report. Closed set
 * so calling models can write deterministic branches off `error.code`
 * instead of pattern-matching free-form strings.
 */
export type ToolErrorCode =
  | 'external_api_failure'
  | 'rate_limited'
  | 'invalid_input'
  | 'internal_error';

/**
 * Phase 09 — status discriminator on every tool response envelope.
 *
 *   'ok'          — tool ran successfully, `data` carries substantive results.
 *   'honest_gap'  — tool ran successfully and found no relevant data. Veto's
 *                   anti-bias signal: the absence IS the finding. `data` may
 *                   be an empty array or a verdict object explaining the gap.
 *                   Distinguishing this from 'error' is structural: a tool
 *                   that returned no Reddit complaints and a tool that
 *                   couldn't reach Reddit are different facts and the
 *                   calling LLM needs to branch on them differently.
 *   'error'       — tool actually failed. `error.code` carries the cause.
 *
 * Models must read this field BEFORE interpreting `data`. The validate_idea
 * prompt explicitly forbids confabulating infrastructure causes when
 * `status === 'error'` — `error.code` is the authoritative source.
 */
export interface ToolResult<T> {
  status: 'ok' | 'honest_gap' | 'error';
  data: T;
  sources: ToolSource[];
  confidence_note: string;
  fallbacks_used: string[];
  /** Populated only on `status === 'error'`. */
  error?: { code: ToolErrorCode; message: string };
}
