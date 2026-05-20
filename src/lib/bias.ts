/**
 * Bias helper module — enforces spec §4 rule 4 + §11 anti-pattern 6.
 *
 * Spec rule (build-spec-v1.0.md §4 rule 4):
 *   `unknown` = treat as `vendor-funded` for confidence math.
 *
 * Spec anti-pattern (§11, anti-pattern 6):
 *   "Defaulting `unknown` bias flag to 'independent' (must default to 'vendor-funded')."
 *
 * All functions in this module are pure: no I/O, no env reads, no fetch.
 * The on-the-wire `bias` field in ToolResult.sources[] is the RAW value
 * (so transparency is preserved); these helpers only affect internal
 * confidence math.
 */

import type { ToolSource } from '../types.js';

export type RawBias = ToolSource['bias'];
export type EffectiveBias = 'independent' | 'vendor-funded' | 'conflicted';

/**
 * Map a raw bias flag to its effective bias for confidence math.
 *
 * Enforces spec §4 rule 4: `unknown` collapses to `vendor-funded`.
 * Other flags pass through unchanged.
 *
 * This is the load-bearing helper. Any call site that reasons about
 * source mix for confidence purposes MUST route through this function
 * instead of reading `source.bias` directly.
 */
export function effectiveBias(flag: RawBias): EffectiveBias {
  if (flag === 'unknown') return 'vendor-funded';
  return flag;
}

/**
 * Count sources whose raw bias is `unknown`.
 *
 * Used for transparency in confidence_note strings — e.g.
 * "N/M sources had unknown bias, treated as vendor-funded for math."
 * (Spec §11 anti-pattern 6: the conversion must be disclosed, not hidden.)
 */
export function requiresUpgradeFromUnknown(sources: ToolSource[]): number {
  let count = 0;
  for (const s of sources) {
    if (s.bias === 'unknown') count++;
  }
  return count;
}

/**
 * Ratio of sources whose effective bias is `conflicted`.
 *
 * Used to enforce spec §4 rule 2: ">30% conflicted → downgrade gate confidence."
 * Returns 0 for an empty array (no division-by-zero).
 */
export function conflictedRatio(sources: ToolSource[]): number {
  if (sources.length === 0) return 0;
  let conflicted = 0;
  for (const s of sources) {
    if (effectiveBias(s.bias) === 'conflicted') conflicted++;
  }
  return conflicted / sources.length;
}

/**
 * Sugar over `conflictedRatio(sources) > threshold`.
 *
 * Default threshold 0.3 per spec §4 rule 2 ("> 30% conflicted").
 */
export function exceedsConflictThreshold(
  sources: ToolSource[],
  threshold = 0.3,
): boolean {
  return conflictedRatio(sources) > threshold;
}

// ---------------------------------------------------------------------------
// Self-check block — runs only when this module is invoked directly via Node.
// `node ./build/lib/bias.js` will execute these assertions; importing as a
// library is a no-op.
// ---------------------------------------------------------------------------

function runSelfCheck(): void {
  const mk = (bias: RawBias): ToolSource => ({
    url: 'https://example.com',
    tier: 'B',
    bias,
    fetched_at: '2026-05-20T00:00:00Z',
    contribution: 'test',
  });

  const assert = (label: string, cond: boolean): void => {
    // eslint-disable-next-line no-console
    console.error(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
    if (!cond) process.exitCode = 1;
  };

  assert(
    "effectiveBias('unknown') === 'vendor-funded'",
    effectiveBias('unknown') === 'vendor-funded',
  );
  assert(
    "effectiveBias('independent') === 'independent'",
    effectiveBias('independent') === 'independent',
  );
  assert('conflictedRatio([]) === 0 (no div-by-zero)', conflictedRatio([]) === 0);

  const twoOfFive: ToolSource[] = [
    mk('conflicted'),
    mk('conflicted'),
    mk('independent'),
    mk('independent'),
    mk('vendor-funded'),
  ];
  assert(
    'exceedsConflictThreshold(2/5 conflicted = 40%) === true',
    exceedsConflictThreshold(twoOfFive) === true,
  );

  const oneOfFive: ToolSource[] = [
    mk('conflicted'),
    mk('independent'),
    mk('independent'),
    mk('vendor-funded'),
    mk('vendor-funded'),
  ];
  assert(
    'exceedsConflictThreshold(1/5 conflicted = 20%) === false',
    exceedsConflictThreshold(oneOfFive) === false,
  );
}

// Cross-platform "is this module the entrypoint?" check for ESM.
const isEntrypoint =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isEntrypoint) {
  runSelfCheck();
}
