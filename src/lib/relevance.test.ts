/**
 * Phase 11 — shared entity-relevance helpers. These guard every external-search
 * tool against laundering keyword noise into signal, so lock the behavior.
 */

import { describe, it, expect } from 'vitest';
import {
  buildRelevanceTerms,
  hasWholeWord,
  isRelevant,
  competitorAppears,
} from './relevance.js';

describe('buildRelevanceTerms', () => {
  it('drops generic tech tokens and keeps multi-word keywords intact', () => {
    const t = buildRelevanceTerms('focus app', ['screen time', 'deep work', 'focus']);
    expect(t).toContain('focus');
    expect(t).toContain('screen time');
    expect(t).not.toContain('app');
  });
});

describe('hasWholeWord', () => {
  it('matches whole words only', () => {
    expect(hasWholeWord('privacy-focused note app', 'focus')).toBe(false);
    expect(hasWholeWord('a focus timer', 'focus')).toBe(true);
  });
});

describe('isRelevant', () => {
  const terms = buildRelevanceTerms('focus app', ['screen time', 'deep work', 'focus']);
  it('drops a result that matches only one generic word', () => {
    expect(isRelevant('Opiniated RAG. Focus on your product.', terms, 'focus app')).toBe(false);
  });
  it('keeps a result matching a specific multi-word keyword', () => {
    expect(isRelevant('Reduce screen time, stay focused', terms, 'focus app')).toBe(true);
  });
  it('keeps a result matching the full category phrase', () => {
    expect(isRelevant('A focus app for iOS', terms, 'focus app')).toBe(true);
  });
});

describe('competitorAppears', () => {
  it('rejects single-word competitor used as a lowercase common word', () => {
    expect(competitorAppears('I craved the freedom of indie life', 'Freedom')).toBe(false);
    expect(competitorAppears('some opal jewelry', 'Opal')).toBe(false);
  });
  it('accepts the Capitalized proper-noun form', () => {
    expect(competitorAppears('Forest has 400K downloads', 'Forest')).toBe(true);
  });
  it('matches multi-word names case-insensitively', () => {
    expect(competitorAppears('the realreal consignment', 'The RealReal')).toBe(true);
  });
  it('does not match a longer word containing the token', () => {
    expect(competitorAppears('Forestry software', 'Forest')).toBe(false);
  });
});

// The exact noise that triggered the 2026-06-17 audit — these are the calls
// every gate tool (T1-T5) now delegates to. Lock them as regressions.
describe('audit-noise regressions', () => {
  it('T1: "Opal apples"/"opal jewelry" are not the Opal app', () => {
    expect(competitorAppears('Anyone else disappointed in the Opal apples this year? Mealy.', 'Opal')).toBe(true); // capitalized — name appears
    // ...but the category/product gate (applied in-tool) rejects it:
    const terms = buildRelevanceTerms('focus app', []);
    expect(isRelevant('Anyone else disappointed in the Opal apples this year? Mealy.', terms, 'focus app')).toBe(false);
  });

  it('T2: an off-topic "Google announces" snippet is not category-relevant', () => {
    const terms = buildRelevanceTerms('secondhand clothing marketplace', []);
    expect(isRelevant('Google announces new Pixel camera features at I/O', terms, 'secondhand clothing marketplace')).toBe(false);
    // A real post-mortem mentioning the category IS relevant:
    expect(isRelevant('The secondhand clothing marketplace shut down after running out of runway', terms, 'secondhand clothing marketplace')).toBe(true);
  });

  it('T2: a known-product mention rescues a snippet with no category words', () => {
    expect(competitorAppears('Poshmark post-mortem: why it stalled', 'Poshmark')).toBe(true);
  });
});
