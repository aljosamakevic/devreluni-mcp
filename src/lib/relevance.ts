/**
 * Phase 11 — shared entity-relevance helpers.
 *
 * Veto's external-search tools keyword/substring-match results to a category
 * or a named competitor. Without disambiguation, off-topic hits get counted
 * as signal: "focus" matches a RAG framework, "freedom" the life-goal matches
 * the Freedom app. These helpers (extracted from estimate_demand_signals and
 * find_public_revenue_signals, then generalized) are the single place that
 * decides "does this text actually refer to the thing we searched for?".
 *
 * Design bias: conservative. When uncertain, EXCLUDE and let the tool report a
 * weaker, honest signal rather than launder noise into confidence. A false
 * "insufficient evidence" is far safer for an anti-bias tool than a false
 * "strong signal".
 */

/**
 * Generic tech words that match almost any result — excluded from the
 * relevance vocabulary so a single match on "app"/"ai"/"tool" can't make an
 * off-topic result look on-topic.
 */
export const GENERIC_CATEGORY_TOKENS = new Set([
  'app', 'apps', 'application', 'tool', 'tools', 'platform', 'software',
  'ai', 'ml', 'native', 'mobile', 'web', 'ios', 'android', 'service',
  'saas', 'api', 'the', 'for', 'and', 'a', 'an',
]);

/** Escape a string for use inside a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word membership test (so "focus" does not match "focused"). */
export function hasWholeWord(haystack: string, word: string): boolean {
  if (word.includes(' ')) return haystack.includes(word); // multi-word phrase
  return new RegExp(`\\b${escapeRegExp(word)}\\b`).test(haystack);
}

/**
 * Build the relevance vocabulary from a category string + optional keywords.
 * Multi-word keywords are kept intact (they're specific); category tokens are
 * split, de-generic'd, and lowercased.
 */
export function buildRelevanceTerms(category: string, keywords: string[] = []): string[] {
  const out = new Set<string>();
  for (const kw of keywords) {
    const k = kw.trim().toLowerCase();
    if (k.length > 0) out.add(k);
  }
  for (const tok of category.toLowerCase().split(/\s+/)) {
    const t = tok.replace(/[^a-z0-9]/g, '');
    if (t.length > 1 && !GENERIC_CATEGORY_TOKENS.has(t)) out.add(t);
  }
  return Array.from(out);
}

/**
 * Does `text` plausibly belong to the category, not merely share one generic
 * word? True if it contains the full category phrase, a specific multi-word
 * keyword, or >=2 distinct specific single-word terms. (Generalized from the
 * GitHub-repo relevance gate; works on any title+snippet text.)
 */
export function isRelevant(
  text: string,
  relevanceTerms: string[],
  categoryPhrase: string,
): boolean {
  const hay = text.toLowerCase();
  if (categoryPhrase && hay.includes(categoryPhrase.toLowerCase())) return true;
  let singleWordHits = 0;
  for (const term of relevanceTerms) {
    if (!hasWholeWord(hay, term)) continue;
    if (term.includes(' ')) return true; // a specific multi-word keyword is decisive
    singleWordHits++;
  }
  return singleWordHits >= 2;
}

/**
 * Does `competitor` appear in `originalText` as a real entity (not a common
 * English word in prose)? Multi-word names ("The RealReal") match
 * case-insensitively. Single-word names must appear as a Capitalized
 * proper-noun whole-word ("Freedom", not "freedom"). Pass ORIGINAL-case text —
 * the capitalization signal is the disambiguator.
 */
export function competitorAppears(originalText: string, competitor: string): boolean {
  const c = competitor.trim();
  if (!c) return false;
  if (/\s/.test(c)) {
    return new RegExp(`\\b${escapeRegExp(c)}\\b`, 'i').test(originalText);
  }
  const cap = c.charAt(0).toUpperCase() + c.slice(1);
  return new RegExp(`\\b${escapeRegExp(cap)}\\b`).test(originalText);
}
