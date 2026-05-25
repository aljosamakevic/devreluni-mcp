// T-V04 — Unit tests for detectRecency().
//
// Recency feeds the adjacency-score heuristic in check_big_tech_encroachment
// and the why-now signal counts in find_why_now_signals. Both treat
// "last_24mo" as a stronger signal than "older" / "unknown", so misclassifying
// year strings would shift gate verdicts.
//
// Module behaviour assumes the process started in 2026; assertions are written
// against the RECENT_YEARS = [CURRENT_YEAR, -1, -2] window, i.e. 2026/2025/2024.

import { describe, it, expect } from 'vitest';
import { detectRecency, CURRENT_YEAR, RECENT_YEARS } from './recency.js';

describe('module constants', () => {
  it('CURRENT_YEAR matches process start year (smoke check)', () => {
    expect(CURRENT_YEAR).toBe(new Date().getFullYear());
  });

  it('RECENT_YEARS is a 3-element window ending at CURRENT_YEAR', () => {
    expect(RECENT_YEARS).toEqual([CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2]);
  });
});

describe('detectRecency() — last_24mo bucket', () => {
  it('classifies CURRENT_YEAR strings as last_24mo', () => {
    expect(detectRecency(`WWDC ${CURRENT_YEAR} session`)).toBe('last_24mo');
  });

  it('classifies CURRENT_YEAR-1 strings as last_24mo', () => {
    expect(detectRecency(`launched in ${CURRENT_YEAR - 1}`)).toBe('last_24mo');
  });

  it('classifies CURRENT_YEAR-2 strings as last_24mo (window edge)', () => {
    // e.g. "In 2024, Apple released..." when CURRENT_YEAR is 2026.
    expect(
      detectRecency(`In ${CURRENT_YEAR - 2}, Apple released the new framework`),
    ).toBe('last_24mo');
  });
});

describe('detectRecency() — older bucket', () => {
  it('classifies a 2019 string as older', () => {
    expect(detectRecency('vintage 2019 article on focus apps')).toBe('older');
  });

  it('classifies a 1999 string as older', () => {
    expect(detectRecency('1999 was a long time ago')).toBe('older');
  });

  it('prefers last_24mo when both a recent year AND an older year appear', () => {
    expect(
      detectRecency(`retrospective from 1999 updated for ${CURRENT_YEAR}`),
    ).toBe('last_24mo');
  });
});

describe('detectRecency() — unknown bucket', () => {
  it("returns 'unknown' for text with no 4-digit year", () => {
    expect(detectRecency('Apple developer documentation')).toBe('unknown');
  });

  it("returns 'unknown' for a 3-digit number (not a year)", () => {
    expect(detectRecency('error 404 page not found')).toBe('unknown');
  });
});
