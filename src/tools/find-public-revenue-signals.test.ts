/**
 * Phase 10 — competitor entity disambiguation for the revenue signal.
 * Locks the fix that stops "freedom" the life-goal from being attributed to
 * the Freedom app (which inflated WTP to a fake "strong" with a $23k headline).
 */

import { describe, it, expect } from 'vitest';
import { competitorAppears } from './find-public-revenue-signals.js';

describe('find_public_revenue_signals competitor disambiguation', () => {
  it('rejects a single-word competitor used as a lowercase common word', () => {
    expect(competitorAppears('I craved for the freedom that indie hackers chase', 'Freedom')).toBe(false);
    expect(competitorAppears('Optimizing for freedom with money as the enabler', 'Freedom')).toBe(false);
    expect(competitorAppears('just some opal jewelry for sale', 'Opal')).toBe(false);
  });

  it('accepts the Capitalized proper-noun form (the actual app)', () => {
    expect(competitorAppears('Forest, for instance, has 400K downloads', 'Forest')).toBe(true);
    expect(competitorAppears('Hitting $23k MRR with the Freedom app blocker', 'Freedom')).toBe(true);
    expect(competitorAppears('Opal screen-time app hit $99/yr', 'Opal')).toBe(true);
  });

  it('matches multi-word competitor names case-insensitively', () => {
    expect(competitorAppears('the realreal reported strong consignment numbers', 'The RealReal')).toBe(true);
    expect(competitorAppears('I use One Sec to add friction', 'one sec')).toBe(true);
  });

  it('does not match a different word that merely contains the token', () => {
    // "Forestry" should not match "Forest" (whole-word boundary).
    expect(competitorAppears('Forestry management software', 'Forest')).toBe(false);
  });
});
