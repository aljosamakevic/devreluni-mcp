import type { ToolSource } from '../types.js';

export interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  url: string;
  subreddit: string;
  score: number;
  num_comments: number;
  created_utc: number;
  permalink: string;
  author: string;
}

export interface RedditSearchResult {
  posts: RedditPost[];
  subreddit?: string;
}

async function getRedditToken(): Promise<string | null> {
  const clientId = process.env['REDDIT_CLIENT_ID'];
  const clientSecret = process.env['REDDIT_CLIENT_SECRET'];
  if (!clientId || !clientSecret) return null;

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'product-validation-mcp/0.1.0',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) return null;
    const data = (await response.json()) as { access_token: string };
    return data.access_token;
  } catch {
    return null;
  }
}

export async function searchReddit(query: string, limit = 10): Promise<RedditSearchResult> {
  const token = await getRedditToken();

  if (!token) {
    return getRedditStub(query);
  }

  try {
    const params = new URLSearchParams({ q: query, limit: String(limit), sort: 'relevance', t: 'year' });
    const response = await fetch(`https://oauth.reddit.com/search?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'product-validation-mcp/0.1.0',
      },
    });

    if (!response.ok) {
      return getRedditStub(query);
    }

    const data = (await response.json()) as {
      data: { children: { data: RedditPost }[] };
    };

    const posts = data.data.children.map((c) => c.data);
    return { posts };
  } catch {
    return getRedditStub(query);
  }
}

function getRedditStub(query: string): RedditSearchResult {
  return {
    posts: [
      {
        id: 'stub1',
        title: `[STUB] Reddit discussions about: ${query}`,
        selftext: `[STUB DATA — set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET for live results] This is a placeholder Reddit post for the query: "${query}". Real data would include actual user complaints, praise, and switching discussions.`,
        url: 'https://reddit.com/r/stub/stub1',
        subreddit: 'stub',
        score: 0,
        num_comments: 0,
        created_utc: Date.now() / 1000,
        permalink: '/r/stub/comments/stub1',
        author: 'stub_user',
      },
    ],
  };
}

export function isRedditLive(): boolean {
  return Boolean(process.env['REDDIT_CLIENT_ID'] && process.env['REDDIT_CLIENT_SECRET']);
}

export function redditSource(query: string): ToolSource {
  const live = isRedditLive();
  return {
    url: `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`,
    tier: 'A',
    bias: 'independent',
    fetched_at: new Date().toISOString(),
    contribution: live
      ? `Reddit search results for: ${query}`
      : `[STUB] Placeholder Reddit data for: ${query} — set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET for live data`,
  };
}

export function redditConfidenceNote(): string {
  return isRedditLive()
    ? 'Reddit data is live.'
    : 'Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET for live Reddit data. Results are stubbed.';
}
