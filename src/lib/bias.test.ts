// T-V02 — Unit tests for src/lib/bias.ts.
//
// Locks in spec §4 rule 4 ("`unknown` collapses to `vendor-funded` for
// confidence math") and spec §4 rule 2 (">30% conflicted → downgrade gate
// confidence"). These are load-bearing for every gate's confidence math, so
// regressions here would silently corrupt downstream verdicts.

import { describe, it, expect } from 'vitest';
import type { ToolSource } from '../types.js';
import {
  effectiveBias,
  requiresUpgradeFromUnknown,
  conflictedRatio,
  exceedsConflictThreshold,
} from './bias.js';

/** Minimal ToolSource factory — only `bias` matters for these tests. */
function mk(bias: ToolSource['bias']): ToolSource {
  return {
    url: 'https://example.com',
    tier: 'B',
    bias,
    fetched_at: '2026-05-25T00:00:00Z',
    contribution: 'test fixture',
  };
}

describe('effectiveBias() — spec §4 rule 4', () => {
  it("maps 'unknown' → 'vendor-funded' (the load-bearing rule)", () => {
    expect(effectiveBias('unknown')).toBe('vendor-funded');
  });

  it("passes through 'independent' unchanged", () => {
    expect(effectiveBias('independent')).toBe('independent');
  });

  it("passes through 'vendor-funded' unchanged", () => {
    expect(effectiveBias('vendor-funded')).toBe('vendor-funded');
  });

  it("passes through 'conflicted' unchanged", () => {
    expect(effectiveBias('conflicted')).toBe('conflicted');
  });
});

describe('requiresUpgradeFromUnknown() — transparency counter', () => {
  it('returns 0 for an empty source array', () => {
    expect(requiresUpgradeFromUnknown([])).toBe(0);
  });

  it('counts only sources whose RAW bias is "unknown"', () => {
    const sources = [mk('unknown'), mk('independent'), mk('vendor-funded')];
    expect(requiresUpgradeFromUnknown(sources)).toBe(1);
  });

  it('returns the array length when every source is unknown', () => {
    expect(requiresUpgradeFromUnknown([mk('unknown'), mk('unknown')])).toBe(2);
  });
});

describe('conflictedRatio() — spec §4 rule 2', () => {
  it('returns 0 for an empty array (no div-by-zero)', () => {
    expect(conflictedRatio([])).toBe(0);
  });

  it('returns 0.5 for one conflicted out of two', () => {
    expect(conflictedRatio([mk('conflicted'), mk('independent')])).toBe(0.5);
  });

  it('treats "unknown" as vendor-funded (NOT conflicted) per rule 4', () => {
    // unknown collapses to vendor-funded for math, not to conflicted.
    expect(conflictedRatio([mk('unknown'), mk('unknown')])).toBe(0);
  });
});

describe('exceedsConflictThreshold() — spec §4 rule 2 (>30%)', () => {
  it('returns true at 40% conflicted with default threshold', () => {
    const sources = [
      mk('conflicted'),
      mk('conflicted'),
      mk('independent'),
      mk('independent'),
      mk('vendor-funded'),
    ];
    expect(exceedsConflictThreshold(sources)).toBe(true);
  });

  it('returns false at 20% conflicted with default threshold', () => {
    const sources = [
      mk('conflicted'),
      mk('independent'),
      mk('independent'),
      mk('vendor-funded'),
      mk('vendor-funded'),
    ];
    expect(exceedsConflictThreshold(sources)).toBe(false);
  });

  it('honours an explicit override threshold (50%, 50% conflicted is NOT >)', () => {
    // exactly threshold should NOT exceed (strict greater-than per spec wording).
    expect(
      exceedsConflictThreshold([mk('conflicted'), mk('independent')], 0.5),
    ).toBe(false);
  });
});
