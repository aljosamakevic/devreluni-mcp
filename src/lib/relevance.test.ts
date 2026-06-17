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
