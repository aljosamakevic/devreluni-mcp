import type { ToolSource } from '../types.js';
import { cacheGet, cacheSet, makeCacheKey, TTL } from './cache.js';

export interface PHPost {
  id: string;
  name: string;
  tagline: string;
  url: string;
  votesCount: number;
  commentsCount: number;
  createdAt: string;
  topics?: { name: string }[];
  thumbnail?: { url: string };
  topComment?: string;
}

const PH_GRAPHQL = 'https://api.producthunt.com/v2/api/graphql';

export async function searchProductHunt(query: string, first = 10): Promise<PHPost[]> {
  const apiKey = process.env['PRODUCTHUNT_API_KEY'];
  if (!apiKey) {
    return getPHStub(query);
  }

  const gql = `
    query SearchPosts($query: String!, $first: Int!) {
      posts(search: $query, first: $first, order: VOTES) {
        edges {
          node {
            id
            name
            tagline
            url
            votesCount
            commentsCount
            createdAt
            topics { edges { node { name } } }
            thumbnail { url }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch(PH_GRAPHQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query: gql, variables: { query, first } }),
    });

    if (!response.ok) {
      return getPHStub(query);
    }

    const data = (await response.json()) as {
      data?: {
        posts?: {
          edges?: { node: {
            id: string;
            name: string;
            tagline: string;
            url: string;
            votesCount: number;
            commentsCount: number;
            createdAt: string;
            topics?: { edges: { node: { name: string } }[] };
            thumbnail?: { url: string };
          } }[];
        };
      };
    };

    const edges = data.data?.posts?.edges ?? [];
    return edges.map((e) => ({
      id: e.node.id,
      name: e.node.name,
      tagline: e.node.tagline,
      url: e.node.url,
      votesCount: e.node.votesCount,
      commentsCount: e.node.commentsCount,
      createdAt: e.node.createdAt,
      topics: e.node.topics?.edges?.map((t) => ({ name: t.node.name })),
      thumbnail: e.node.thumbnail,
    }));
  } catch {
    return getPHStub(query);
  }
}

function getPHStub(query: string): PHPost[] {
  return [
    {
      id: 'stub1',
      name: `[STUB] Product Hunt result for: ${query}`,
      tagline: '[STUB DATA — set PRODUCTHUNT_API_KEY for live results]',
      url: 'https://producthunt.com',
      votesCount: 0,
      commentsCount: 0,
      createdAt: new Date().toISOString(),
      topics: [{ name: 'Stub' }],
      topComment: 'Stub data — no real comments available without API key.',
    },
  ];
}

export function isPHLive(): boolean {
  return Boolean(process.env['PRODUCTHUNT_API_KEY']);
}

export function phSource(query: string): ToolSource {
  const live = isPHLive();
  return {
    url: `https://www.producthunt.com/search?q=${encodeURIComponent(query)}`,
    tier: 'A',
    bias: 'independent',
    fetched_at: new Date().toISOString(),
    contribution: live
      ? `Product Hunt launches for: ${query}`
      : `[STUB] Placeholder Product Hunt data for: ${query} — set PRODUCTHUNT_API_KEY for live data`,
  };
}

export function phConfidenceNote(): string {
  return isPHLive()
    ? 'Product Hunt data is live.'
    : 'Set PRODUCTHUNT_API_KEY for live Product Hunt data. Results are stubbed.';
}

export interface PHTopic {
  slug: string;
  name: string;
  followersCount: number;
}

/**
 * Resolves a free-form category string to a Product Hunt topic slug.
 * Strategy: query the PH `topics(query: ..., first: 5)` GraphQL endpoint and
 * pick the topic whose name best matches the category (case-insensitive exact,
 * then substring, then highest followersCount).
 *
 * Returns null when:
 *   - PRODUCTHUNT_API_KEY is absent
 *   - The topics API rejects auth / returns an unknown-field error
 *   - No edges are returned for the query
 *   - Network/parse failure
 *
 * Callers (e.g. scan_producthunt_launches) MUST surface a null result in
 * `confidence_note` per spec §11 anti-pattern 2 (no silent failures).
 *
 * Fallback behavior is documented in deferred-items D-T07-1.
 */
export async function resolveTopicSlug(category: string): Promise<string | null> {
  const apiKey = process.env['PRODUCTHUNT_API_KEY'];
  if (!apiKey) return null;

  const cacheKey = makeCacheKey('ph-topic', category);
  const cached = cacheGet<string | null>(cacheKey);
  if (cached !== null) return cached;
  // Note: cacheGet returns null both for "miss" and for "cached null"; in the
  // latter case we re-fetch, which is acceptable (negative caching defeated
  // but correctness preserved).

  const gql = `
    query SearchTopics($query: String!, $first: Int!) {
      topics(query: $query, first: $first) {
        edges {
          node {
            slug
            name
            followersCount
          }
        }
      }
    }
  `;

  try {
    const response = await fetch(PH_GRAPHQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query: gql, variables: { query: category, first: 5 } }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      data?: {
        topics?: {
          edges?: { node: { slug: string; name: string; followersCount: number } }[];
        };
      };
      errors?: { message: string }[];
    };

    if (data.errors && data.errors.length > 0) {
      // "not authorized" or "unknown field" — fallback path. Caller logs the gap.
      return null;
    }

    const edges = data.data?.topics?.edges ?? [];
    if (edges.length === 0) return null;

    const lower = category.toLowerCase().trim();
    const topics: PHTopic[] = edges.map((e) => e.node);

    // 1) exact case-insensitive name match
    const exact = topics.find((t) => t.name.toLowerCase() === lower);
    // 2) substring (either direction)
    const substring = topics.find(
      (t) => t.name.toLowerCase().includes(lower) || lower.includes(t.name.toLowerCase())
    );
    // 3) highest followersCount
    const byFollowers = [...topics].sort((a, b) => b.followersCount - a.followersCount)[0];

    const pick = exact ?? substring ?? byFollowers;
    const slug = pick?.slug ?? null;
    cacheSet(cacheKey, slug, TTL.LONG);
    return slug;
  } catch {
    return null;
  }
}

/**
 * Fetches Product Hunt posts associated with a specific topic slug,
 * ordered by VOTES. Returns [] when the API key is absent or on any failure.
 */
export async function searchPostsByTopic(slug: string, limit = 15): Promise<PHPost[]> {
  const apiKey = process.env['PRODUCTHUNT_API_KEY'];
  if (!apiKey) return [];

  const gql = `
    query PostsByTopic($slug: String!, $first: Int!) {
      topic(slug: $slug) {
        posts(first: $first, order: VOTES) {
          edges {
            node {
              id
              name
              tagline
              url
              votesCount
              commentsCount
              createdAt
              topics { edges { node { name } } }
              thumbnail { url }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch(PH_GRAPHQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query: gql, variables: { slug, first: limit } }),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
      data?: {
        topic?: {
          posts?: {
            edges?: { node: {
              id: string;
              name: string;
              tagline: string;
              url: string;
              votesCount: number;
              commentsCount: number;
              createdAt: string;
              topics?: { edges: { node: { name: string } }[] };
              thumbnail?: { url: string };
            } }[];
          };
        };
      };
      errors?: { message: string }[];
    };

    if (data.errors && data.errors.length > 0) return [];

    const edges = data.data?.topic?.posts?.edges ?? [];
    return edges.map((e) => ({
      id: e.node.id,
      name: e.node.name,
      tagline: e.node.tagline,
      url: e.node.url,
      votesCount: e.node.votesCount,
      commentsCount: e.node.commentsCount,
      createdAt: e.node.createdAt,
      topics: e.node.topics?.edges?.map((t) => ({ name: t.node.name })),
      thumbnail: e.node.thumbnail,
    }));
  } catch {
    return [];
  }
}
