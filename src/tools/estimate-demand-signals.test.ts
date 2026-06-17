/**
 * Phase 10 — relevance filtering for the GitHub demand signal.
 * Locks the disambiguation that drops off-topic keyword matches (Quivr, a RAG
 * framework, for "focus app") so they can't inflate the demand verdict.
 */

import { describe, it, expect } from 'vitest';
import { isRepoRelevant, buildRelevanceTerms } from './estimate-demand-signals.js';

describe('estimate_demand_signals relevance filter', () => {
  const terms = buildRelevanceTerms('focus app', ['screen time', 'deep work', 'focus']);

  it('strips generic tech words from the relevance vocabulary', () => {
    // "app" is generic and must not anchor relevance; keywords are kept intact.
    expect(terms).toContain('focus');
    expect(terms).toContain('screen time');
    expect(terms).not.toContain('app');
  });

  it('drops a RAG framework that only matches the word "focus"', () => {
    const quivr = {
      full_name: 'QuivrHQ/quivr',
      description: 'Opiniated RAG for integrating GenAI in your apps. Focus on your product rather than the RAG.',
    };
    expect(isRepoRelevant(quivr, terms, 'focus app')).toBe(false);
  });

  it('drops a notes app matching only "focus" inside "privacy-focused"', () => {
    const joplin = {
      full_name: 'laurent22/joplin',
      description: 'Joplin - the privacy-focused note taking app with sync.',
    };
    expect(isRepoRelevant(joplin, terms, 'focus app')).toBe(false);
  });

  it('keeps a repo that matches a specific multi-word keyword', () => {
    const real = {
      full_name: 'acme/timewall',
      description: 'Block distracting apps. Reduce screen time. Stay focused.',
    };
    expect(isRepoRelevant(real, terms, 'focus app')).toBe(true);
  });

  it('keeps a repo that matches the full category phrase', () => {
    const real = {
      full_name: 'someone/myfocusapp',
      description: 'A focus app for deep work on iOS.',
    };
    expect(isRepoRelevant(real, terms, 'focus app')).toBe(true);
  });
});
