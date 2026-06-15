/**
 * Phase 09 — tool response envelope helpers.
 *
 * Every tool routes its return value through one of three constructors so
 * the status discriminator on ToolResult<T> can never accidentally be
 * omitted. Tool authors pick the helper that matches the SEMANTICS of the
 * response, not the shape of the data:
 *
 *   - okResult         — tool ran successfully and `data` carries the
 *                        substantive results the calling LLM should use.
 *
 *   - honestGapResult  — tool ran successfully and found no relevant data.
 *                        Veto's anti-bias signal. The empty array (or
 *                        verdict-only response) is itself the finding.
 *                        Calling models must NOT interpret this as a
 *                        tool failure — see src/prompts/validate-idea.ts.
 *
 *   - errorResult      — tool actually failed. `code` is one of the four
 *                        canonical reasons; the calling model branches on
 *                        the code, not on the free-form `message`.
 *
 * A tool that delivered useful results from a degraded path (e.g. Serper
 * was rate-limited so the tool fell back to Reddit) returns okResult with
 * `fallbacks_used` populated — that's a successful run, not an error.
 * fallbacks_used is provenance metadata; status reports what the model
 * should DO with the response.
 */

import type { ToolErrorCode, ToolResult, ToolSource } from '../types.js';

export const TOOL_ERROR_CODES = {
  EXTERNAL_API_FAILURE: 'external_api_failure',
  RATE_LIMITED: 'rate_limited',
  INVALID_INPUT: 'invalid_input',
  INTERNAL_ERROR: 'internal_error',
} as const satisfies Record<string, ToolErrorCode>;

export function okResult<T>(
  data: T,
  sources: ToolSource[],
  confidence_note: string,
  fallbacks_used: string[] = []
): ToolResult<T> {
  return { status: 'ok', data, sources, confidence_note, fallbacks_used };
}

export function honestGapResult<T>(
  data: T,
  sources: ToolSource[],
  confidence_note: string,
  fallbacks_used: string[] = []
): ToolResult<T> {
  return { status: 'honest_gap', data, sources, confidence_note, fallbacks_used };
}

export function errorResult(
  code: ToolErrorCode,
  message: string,
  sources: ToolSource[] = [],
  fallbacks_used: string[] = []
): ToolResult<null> {
  return {
    status: 'error',
    data: null,
    sources,
    confidence_note: '',
    fallbacks_used,
    error: { code, message },
  };
}
