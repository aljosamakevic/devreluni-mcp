// Product Hunt API v2 (GraphQL)
// STUB: returns mock data. Wire up by setting PRODUCTHUNT_API_KEY.
// Apply at: https://api.producthunt.com/v2/docs
// TODO: Replace stub with real GraphQL queries once key is approved.

import { cacheGet, cacheSet, makeCacheKey, TTL } from './cache.js';

const API_KEY = process.env.PRODUCTHUNT_API_KEY;
const BASE = 'https://api.producthunt.com/v2/api/graphql';

export interface PHProduct {
  name: string;
  tagline: string;
  url: string;
  votes: number;
  comments: number;
  launched_at: string;
  topics: string[];
  top_comment?: string;
}

export interface PHSearchResult {
  products: PHProduct[];
  query: string;
  stubbed: boolean;
}

// GraphQL query to fetch posts by topic/search
const SEARCH_QUERY = `
  query SearchPosts($query: String!, $after: String) {
    posts(search: { query: $query }, after: $after, first: 10, order: VOTES) {
      edges {
        node {
          name
          tagline
          website
          votesCount
          commentsCount
          createdAt
          topics { edges { node { name } } }
        }
      }
    }
  }
`;

export async function searchProductHunt(
  query: string,
  _dateRange?: { from: string; to?: string },
): Promise<PHSearchResult> {
  const cacheKey = makeCacheKey('ph', query);
  const cached = cacheGet<PHSearchResult>(cacheKey);
  if (cached) return cached;

  // --- Real implementation (uncomment when key is set) ---
  if (API_KEY) {
    const response = await fetch(BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ query: SEARCH_QUERY, variables: { query } }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) throw new Error(`Product Hunt API error: ${response.status}`);
    // TODO: map GraphQL response to PHProduct[]
    throw new Error('Product Hunt real response mapping not yet implemented — see producthunt.ts TODO');
  }

  // --- STUB ---
  console.error(`[producthunt] STUB — set PRODUCTHUNT_API_KEY for live results for: "${query}"`);
  const stub: PHSearchResult = {
    query,
    stubbed: true,
    products: [
      {
        name: '[STUB] FocusFlow AI',
        tagline: 'AI-powered focus sessions that adapt to your work style',
        url: 'https://producthunt.com/stub',
        votes: 843,
        comments: 127,
        launched_at: '2025-11-12T00:00:00Z',
        topics: ['Productivity', 'Artificial Intelligence', 'Task Management'],
        top_comment: '[STUB] "Finally an app that understands context switching — congrats on the launch!"',
      },
      {
        name: '[STUB] Fomi',
        tagline: 'Screen monitoring for deep work, without the surveillance feeling',
        url: 'https://producthunt.com/stub2',
        votes: 412,
        comments: 89,
        launched_at: '2025-10-28T00:00:00Z',
        topics: ['Productivity', 'Focus', 'ADHD'],
        top_comment: '[STUB] "Love the privacy-first approach but worried about the cloud screenshots"',
      },
    ],
  };

  cacheSet(cacheKey, stub, TTL.LONG);
  return stub;
}
