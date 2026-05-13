// Reddit API — OAuth app, free for non-commercial use
// STUB: returns mock data. Wire up by setting REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET.
// Register at: https://www.reddit.com/prefs/apps
// TODO: Replace stub body with real OAuth + search implementation.

import { cacheGet, cacheSet, makeCacheKey, TTL } from './cache.js';

const CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;

export interface RedditPost {
  title: string;
  subreddit: string;
  score: number;
  url: string;
  permalink: string;
  selftext_preview: string; // first 300 chars
  num_comments: number;
  created_utc: number;
}

export interface RedditSearchResult {
  posts: RedditPost[];
  query: string;
  stubbed: boolean;
}

export async function searchReddit(
  query: string,
  subreddit?: string,
  sort: 'relevance' | 'top' | 'new' = 'relevance',
  limit = 10,
): Promise<RedditSearchResult> {
  const cacheKey = makeCacheKey('reddit', query, subreddit ?? 'all', sort);
  const cached = cacheGet<RedditSearchResult>(cacheKey);
  if (cached) return cached;

  // --- Real implementation (uncomment when credentials are set) ---
  if (CLIENT_ID && CLIENT_SECRET) {
    // 1. Get bearer token via client_credentials flow
    // 2. GET https://oauth.reddit.com/r/{subreddit}/search?q={query}&sort={sort}&limit={limit}
    // 3. Map response.data.children to RedditPost[]
    // Full implementation: https://www.reddit.com/dev/api/oauth#GET_search
    throw new Error('Reddit real implementation not yet wired up — see reddit.ts TODO');
  }

  // --- STUB ---
  console.error(`[reddit] STUB — set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET for live results for: "${query}"`);
  const stub: RedditSearchResult = {
    query,
    stubbed: true,
    posts: [
      {
        title: `[STUB] "Is anyone else frustrated with ${query}?"`,
        subreddit: 'entrepreneur',
        score: 847,
        url: 'https://reddit.com/stub',
        permalink: '/r/entrepreneur/stub',
        selftext_preview: 'Stubbed post body. Real posts will surface pain points, competitor complaints, and unmet needs.',
        num_comments: 134,
        created_utc: Date.now() / 1000,
      },
      {
        title: `[STUB] "Tried every ${query} tool — here's what I found"`,
        subreddit: 'productivity',
        score: 312,
        url: 'https://reddit.com/stub2',
        permalink: '/r/productivity/stub2',
        selftext_preview: 'Another stubbed post. Live data will show what users actually complain about.',
        num_comments: 67,
        created_utc: Date.now() / 1000 - 86400,
      },
    ],
  };

  cacheSet(cacheKey, stub, TTL.MEDIUM);
  return stub;
}
