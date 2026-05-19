import type { ToolSource } from '../types.js';

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
