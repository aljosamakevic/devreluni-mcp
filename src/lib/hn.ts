import { cacheGet, cacheSet, makeCacheKey, TTL } from './cache.js';
import type { ToolSource } from '../types.js';

export interface HNHit {
  objectID: string;
  title?: string;
  url?: string;
  story_url?: string;
  author: string;
  points: number;
  num_comments: number;
  created_at: string;
  story_text?: string;
  comment_text?: string;
  _highlightResult?: {
    title?: { value: string };
    story_text?: { value: string };
  };
}

export interface HNSearchResult {
  hits: HNHit[];
  nbHits: number;
  page: number;
  hitsPerPage: number;
}

const HN_ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';

export async function searchHN(query: string, hitsPerPage = 10): Promise<HNHit[]> {
  const cacheKey = makeCacheKey('hn', query, String(hitsPerPage));
  const cached = cacheGet<HNHit[]>(cacheKey);
  if (cached) return cached;

  try {
    const params = new URLSearchParams({
      query,
      hitsPerPage: String(hitsPerPage),
      tags: 'story',
    });
    const url = `${HN_ALGOLIA_BASE}/search?${params}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'product-validation-mcp/0.1.0' },
    });
    if (!response.ok) {
      throw new Error(`HN Algolia returned ${response.status}`);
    }
    const data = (await response.json()) as HNSearchResult;
    const hits = data.hits ?? [];
    cacheSet(cacheKey, hits, TTL.MEDIUM);
    return hits;
  } catch (err) {
    console.error('[hn.ts] searchHN error:', err);
    return [];
  }
}

export function hnSource(query: string): ToolSource {
  return {
    url: `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story`,
    tier: 'A',
    bias: 'independent',
    fetched_at: new Date().toISOString(),
    contribution: `HN discussion search for: ${query}`,
  };
}
