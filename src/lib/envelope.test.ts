/**
 * Phase 09 T08 — envelope helper unit tests.
 *
 * Locks down the three constructors so a future "small" change can't drift
 * the envelope shape that the validate_idea prompt and every calling LLM
 * now depend on.
 */

import { describe, it, expect } from 'vitest';
import { okResult, honestGapResult, errorResult, TOOL_ERROR_CODES } from './envelope.js';

describe('envelope helpers', () => {
  it('okResult: status=ok, no error field, fallbacks default to []', () => {
    const r = okResult({ x: 1 }, [], 'note');
    expect(r.status).toBe('ok');
    expect(r.data).toEqual({ x: 1 });
    expect(r.confidence_note).toBe('note');
    expect(r.fallbacks_used).toEqual([]);
    expect(r.error).toBeUndefined();
  });

  it('okResult: passes through provided fallbacks_used', () => {
    const r = okResult({ x: 1 }, [], 'note', ['serper_global_cap']);
    expect(r.fallbacks_used).toEqual(['serper_global_cap']);
    expect(r.status).toBe('ok'); // degraded but still ok
  });

  it('honestGapResult: status=honest_gap, data passed through (empty arrays OK)', () => {
    const r = honestGapResult({ items: [] as unknown[] }, [], 'no matches');
    expect(r.status).toBe('honest_gap');
    expect(r.data).toEqual({ items: [] });
    expect(r.error).toBeUndefined();
  });

  it('errorResult: status=error, data=null, sources/fallbacks default empty, error populated', () => {
    const r = errorResult(TOOL_ERROR_CODES.EXTERNAL_API_FAILURE, 'Serper 500');
    expect(r.status).toBe('error');
    expect(r.data).toBeNull();
    expect(r.sources).toEqual([]);
    expect(r.fallbacks_used).toEqual([]);
    expect(r.error).toEqual({ code: 'external_api_failure', message: 'Serper 500' });
  });

  it('errorResult: accepts optional sources + fallbacks_used', () => {
    const sources = [
      { url: 'https://x', tier: 'B' as const, bias: 'independent' as const, fetched_at: 'ISO', contribution: 'c' },
    ];
    const r = errorResult(TOOL_ERROR_CODES.RATE_LIMITED, 'cap hit', sources, ['serper_per_token_cap']);
    expect(r.sources).toEqual(sources);
    expect(r.fallbacks_used).toEqual(['serper_per_token_cap']);
  });

  it('TOOL_ERROR_CODES enumerates the four canonical codes', () => {
    expect(TOOL_ERROR_CODES.EXTERNAL_API_FAILURE).toBe('external_api_failure');
    expect(TOOL_ERROR_CODES.RATE_LIMITED).toBe('rate_limited');
    expect(TOOL_ERROR_CODES.INVALID_INPUT).toBe('invalid_input');
    expect(TOOL_ERROR_CODES.INTERNAL_ERROR).toBe('internal_error');
  });
});
