// Hacker News via Algolia API — free, no key, no rate limit published.
// Real implementation (not a stub).

import { cacheGet, cacheSet, makeCacheKey, TTL } from './cache.js';

const BASE = 'https://hn.algolia.com/api/v1';

export interface HNHit {
  objectID: string;
  title?: string;
  story_text?: string;
  comment_text?: string;
  author: string;
  points?: number;
  num_comments?: number;
  url?: string;
  created_at: string;
  _tags: string[];
}

export interface HNSearchResult {
  hits: HNHit[];
  nbHits: number;
  query: string;
}

export async function searchHN(
  query: string,
  type: 'story' | 'comment' | 'all' = 'story',
  limit = 10,
): Promise<HNSearchResult> {
  const cacheKey = makeCacheKey('hn', query, type, String(limit));
  const cached = cacheGet<HNSearchResult>(cacheKey);
  if (cached) return cached;

  const tags = type === 'all' ? '' : `&tags=${type}`;
  const url = `${BASE}/search?query=${encodeURIComponent(query)}&hitsPerPage=${limit}${tags}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`HN Algolia API error: ${response.status}`);
  }

  const json = (await response.json()) as HNSearchResult;
  cacheSet(cacheKey, json, TTL.MEDIUM);
  return json;
}

// Parses monthly "Ask HN: Who is Hiring?" threads for keyword frequency.
export async function searchHNHiring(keyword: string, limit = 5): Promise<HNHit[]> {
  const result = await searchHN(`Who is Hiring ${keyword}`, 'comment', limit);
  return result.hits;
}
