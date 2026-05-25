// T-V07 — Regression guard for D-T16-1 (longest-trigger-first matcher in
// platform-keywords). The PLATFORM_KEYWORDS array is ordered by ECOSYSTEM for
// human reviewability, but `getMatchingPlatforms` MUST iterate a specificity-
// sorted view so the most-specific trigger wins (e.g. "Android Digital
// Wellbeing" beats the bare "android" trigger of "Android platform APIs").
//
// If these tests later fail, the longest-trigger-first guarantee has regressed
// — re-read the comment block above getMatchingPlatforms() before "fixing"
// them. Restoring declaration-order iteration would re-open D-T16-1.

import { describe, expect, it } from 'vitest';
import { getMatchingPlatforms } from './platform-keywords.js';

describe('getMatchingPlatforms — longest-trigger-first precedence (D-T16-1)', () => {
  it('matches "Android Digital Wellbeing" specifically, not the broader Android entry', () => {
    // "android digital wellbeing" contains the substring "android", which would
    // match the broader "Android platform APIs" entry. The specificity sort
    // must put the dedicated Wellbeing entry FIRST.
    const hits = getMatchingPlatforms('Android Digital Wellbeing focus app');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].platform).toBe('Android Digital Wellbeing');
  });

  it('matches the broader "Android platform APIs" entry when only "android" appears', () => {
    const hits = getMatchingPlatforms('my app uses android-only features');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].platform).toBe('Android platform APIs');
  });

  it('matches "Apple Screen Time API" specifically when triggered explicitly', () => {
    const hits = getMatchingPlatforms('We integrate the Apple Screen Time API');
    const names = hits.map((h) => h.platform);
    expect(names).toContain('Apple Screen Time API');
    // Screen Time API must appear before the broader iOS/Apple entry.
    const screenTimeIdx = names.indexOf('Apple Screen Time API');
    const iosIdx = names.indexOf('iOS / Apple platform APIs');
    if (iosIdx >= 0) {
      expect(screenTimeIdx).toBeLessThan(iosIdx);
    }
  });

  it('matches "iOS / Apple platform APIs" for generic iOS-only language', () => {
    const hits = getMatchingPlatforms('iOS app development with iPhone-only APIs');
    const names = hits.map((h) => h.platform);
    expect(names).toContain('iOS / Apple platform APIs');
  });

  it('returns empty array (no platform match) for unrelated text', () => {
    const hits = getMatchingPlatforms('completely unrelated marketing copy about widgets');
    expect(hits).toEqual([]);
  });

  it('matches a Chrome-related entry for "Chrome Web Store extension"', () => {
    const hits = getMatchingPlatforms('we publish a chrome extension via the web store');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].platform).toBe('Chrome Web Store');
  });

  it('multi-match: returns BOTH the broader Apple entry AND Screen Time API, specific first', () => {
    // PLAN T-V07 acceptance: "my ios app needs the screen time api" should
    // return both Apple Screen Time API (specific) and iOS / Apple platform
    // APIs (broader), with the more-specific entry ordered first.
    const hits = getMatchingPlatforms('my ios app needs the screen time api');
    const names = hits.map((h) => h.platform);
    expect(names).toContain('Apple Screen Time API');
    expect(names).toContain('iOS / Apple platform APIs');
    expect(names.indexOf('Apple Screen Time API')).toBeLessThan(
      names.indexOf('iOS / Apple platform APIs')
    );
  });

  it('multi-match: chrome extension + openai returns both ecosystem entries', () => {
    const hits = getMatchingPlatforms('chrome extension built on openai');
    const names = hits.map((h) => h.platform);
    expect(names).toContain('Chrome Web Store');
    expect(names).toContain('OpenAI API');
  });
});
