// Reddit search via Serper (Google) with `site:reddit.com` instead of the Reddit OAuth API.
//
// Why: Reddit gates app creation aggressively (Responsible Builder Policy);
// for our use case (surfacing pain-point quotes from competitor discussions),
// Google's index of Reddit captures the signal we need without auth.
//
// Tradeoffs vs. OAuth API:
//   ✓ Zero Reddit credentials required
//   ✓ One less integration to maintain (Serper already in the stack)
//   ✗ Snippets only — no full comment threads
//   ✗ Score / comment_count not available — set to 0
//   ✗ Subreddit extracted heuristically from URL
//
// Source tier: B (aggregated snippet, not direct API) — honest about what we get.

import type { ToolSource } from '../types.js';
import { serperSearch, isSerperLive } from './serper.js';

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

/** Extract subreddit name from a reddit.com URL. Returns 'unknown' if not parseable. */
function extractSubreddit(url: string): string {
  const match = url.match(/reddit\.com\/r\/([^/]+)/i);
  return match ? match[1] : 'unknown';
}

/** Convert a full reddit.com URL into a permalink (path-only). */
function urlToPermalink(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Stable-ish post id derived from the URL (last path segment). */
function urlToId(url: string): string {
  const segments = urlToPermalink(url).split('/').filter(Boolean);
  return segments[segments.length - 1] ?? 'unknown';
}

export async function searchReddit(query: string, limit = 10): Promise<RedditSearchResult> {
  // Force Reddit-only results via Google's site: operator.
  const scopedQuery = `${query} site:reddit.com`;

  const results = await serperSearch(scopedQuery, limit);

  const posts: RedditPost[] = results
    .filter((r) => r.link.includes('reddit.com'))
    .map((r) => ({
      id: urlToId(r.link),
      title: r.title,
      selftext: r.snippet,
      url: r.link,
      subreddit: extractSubreddit(r.link),
      score: 0, // not available from SERP
      num_comments: 0, // not available from SERP
      created_utc: 0, // not available from SERP
      permalink: urlToPermalink(r.link),
      author: 'unknown', // not available from SERP
    }));

  return { posts };
}

export function isRedditLive(): boolean {
  // Reddit data is "live" iff our underlying SERP fetcher is live.
  return isSerperLive();
}

export function redditSource(query: string): ToolSource {
  const live = isRedditLive();
  return {
    url: `https://www.google.com/search?q=${encodeURIComponent(query + ' site:reddit.com')}`,
    tier: 'B', // aggregated snippets — not first-party Reddit API
    bias: 'independent',
    fetched_at: new Date().toISOString(),
    contribution: live
      ? `Reddit discussions surfaced via Google SERP for: ${query} (site:reddit.com)`
      : `[STUB] Placeholder Reddit data for: ${query} — set SERPER_API_KEY for live data`,
  };
}

export function redditConfidenceNote(): string {
  return isRedditLive()
    ? 'Reddit data sourced via Serper (Google) with site:reddit.com. Tier B — snippets only, no full threads, no score/comment counts.'
    : 'Set SERPER_API_KEY for live Reddit data via Google. Results are stubbed.';
}
