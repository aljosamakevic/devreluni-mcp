// Serper.dev — Google Search API
// STUB: returns mock data. Wire up by setting SERPER_API_KEY env var.
// Free tier: 2,500 searches/month — https://serper.dev
// TODO: Replace stub body with real implementation once key is set.

import { cacheGet, cacheSet, makeCacheKey, TTL } from './cache.js';

const API_KEY = process.env.SERPER_API_KEY;
const BASE = 'https://google.serper.dev/search';

export interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
}

export interface SerperResponse {
  organic: SerperResult[];
  peopleAlsoAsk?: { question: string; snippet: string }[];
  relatedSearches?: { query: string }[];
  query: string;
  stubbed: boolean;
}

export async function searchWeb(query: string, limit = 10): Promise<SerperResponse> {
  const cacheKey = makeCacheKey('serper', query, String(limit));
  const cached = cacheGet<SerperResponse>(cacheKey);
  if (cached) return cached;

  // --- Real implementation (uncomment when SERPER_API_KEY is set) ---
  if (API_KEY) {
    const response = await fetch(BASE, {
      method: 'POST',
      headers: {
        'X-API-KEY': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: limit }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) throw new Error(`Serper API error: ${response.status}`);
    const json = await response.json() as Omit<SerperResponse, 'query' | 'stubbed'>;
    const result: SerperResponse = { ...json, query, stubbed: false };
    cacheSet(cacheKey, result, TTL.SHORT);
    return result;
  }

  // --- STUB ---
  console.error(`[serper] STUB — set SERPER_API_KEY to get live results for: "${query}"`);
  const stub: SerperResponse = {
    query,
    stubbed: true,
    organic: [
      {
        title: `[STUB] Top result for "${query}"`,
        link: 'https://example.com/result-1',
        snippet: 'This is a stubbed search result. Set SERPER_API_KEY for live data.',
        date: new Date().toISOString(),
      },
      {
        title: `[STUB] Second result for "${query}"`,
        link: 'https://example.com/result-2',
        snippet: 'Another stubbed result. Real results will include competitor pages, press coverage, and changelogs.',
      },
    ],
    peopleAlsoAsk: [
      { question: `What are alternatives to ${query}?`, snippet: '[STUB] Stubbed PAA answer.' },
    ],
    relatedSearches: [
      { query: `${query} pricing` },
      { query: `${query} review` },
      { query: `${query} vs competitors` },
    ],
  };

  cacheSet(cacheKey, stub, TTL.SHORT);
  return stub;
}
