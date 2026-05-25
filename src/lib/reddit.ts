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
import { cacheGet, cacheSet, makeCacheKey, TTL } from './cache.js';

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
export function extractSubreddit(url: string): string {
  const match = url.match(/reddit\.com\/r\/([^/]+)/i);
  return match ? match[1] : 'unknown';
}

/** Convert a full reddit.com URL into a permalink (path-only). */
export function urlToPermalink(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Stable-ish post id derived from the URL (last path segment). */
export function urlToId(url: string): string {
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

// ---------------------------------------------------------------------------
// Subreddit metadata (no-auth /r/<sub>/about.json)
//
// Why a separate path from searchReddit():
//   - Serper-via-SERP can't return subscriber counts (CONCERNS.md M7).
//   - We don't want to take on Reddit OAuth (Responsible Builder Policy).
//   - Reddit's public about.json works without credentials for any
//     SFW + non-private subreddit, returning subscriber counts directly.
//
// Tier: A (first-party Reddit data, but a user-aggregated count rather
// than raw S-tier first-party numerics like a SEC filing).
// Bias: independent (Reddit has no stake in any product category).
// ---------------------------------------------------------------------------

export interface SubredditMeta {
  name: string;
  subscribers: number;
  active_user_count: number | null;
  created_utc: number;
  description: string;
  over18: boolean;
}

interface RedditAboutResponse {
  data?: {
    display_name?: string;
    subscribers?: number;
    active_user_count?: number | null;
    created_utc?: number;
    public_description?: string;
    description?: string;
    over18?: boolean;
  };
}

const SUBREDDIT_META_TIMEOUT_MS = 5_000;

export async function getSubredditMeta(name: string): Promise<SubredditMeta | null> {
  const cacheKey = makeCacheKey('reddit-meta', name);
  const cached = cacheGet<SubredditMeta>(cacheKey);
  // We only cache hits. Nonexistent / private subs re-fetch on each call,
  // which is fine — those are rare in practice and cheap to re-resolve.
  if (cached) return cached;

  try {
    const url = `https://www.reddit.com/r/${encodeURIComponent(name)}/about.json`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'product-validation-mcp/0.1.0' },
      signal: AbortSignal.timeout(SUBREDDIT_META_TIMEOUT_MS),
    });

    if (!response.ok) {
      // 404 → doesn't exist; 403 → private/quarantined; both → null.
      return null;
    }

    const json = (await response.json()) as RedditAboutResponse;
    const data = json.data;
    if (!data || typeof data.subscribers !== 'number') {
      // Private/quarantined subs can return 200 with an empty/listing body.
      return null;
    }

    const meta: SubredditMeta = {
      name: data.display_name ?? name,
      subscribers: data.subscribers,
      active_user_count:
        typeof data.active_user_count === 'number' ? data.active_user_count : null,
      created_utc: typeof data.created_utc === 'number' ? data.created_utc : 0,
      description: data.public_description ?? data.description ?? '',
      over18: Boolean(data.over18),
    };

    cacheSet(cacheKey, meta, TTL.LONG);
    return meta;
  } catch (err) {
    console.error('[reddit.ts] getSubredditMeta error:', err);
    return null;
  }
}

export function subredditMetaSource(name: string): ToolSource {
  return {
    url: `https://www.reddit.com/r/${encodeURIComponent(name)}/about.json`,
    tier: 'A', // first-party Reddit data, aggregated subscriber count
    bias: 'independent',
    fetched_at: new Date().toISOString(),
    contribution: `Subreddit metadata (subscribers, activity) for r/${name}`,
  };
}

// ---- self-check ------------------------------------------------------------

const isDirectRun = (() => {
  try {
    const here = new URL(import.meta.url).pathname;
    const invoked = process.argv[1] ?? '';
    return here === invoked || here.endsWith(invoked) || invoked.endsWith(here);
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  (async () => {
    console.log('[reddit.ts self-check] getSubredditMeta');
    const t1 = Date.now();
    const a = await getSubredditMeta('productivity');
    const t1ms = Date.now() - t1;
    console.log(
      `getSubredditMeta('productivity') -> ${a ? `subscribers=${a.subscribers}, active=${a.active_user_count}` : 'null'} (${t1ms}ms)`,
    );
    if (!a || a.subscribers <= 100_000) {
      console.log('WARNING: expected subscribers > 100,000 for r/productivity');
    }

    const t2 = Date.now();
    const b = await getSubredditMeta('thissubdoesnotexistforreal_xyz999');
    const t2ms = Date.now() - t2;
    console.log(
      `getSubredditMeta('thissubdoesnotexistforreal_xyz999') -> ${b === null ? 'null (expected)' : 'UNEXPECTED non-null'} (${t2ms}ms)`,
    );

    const t3 = Date.now();
    const c = await getSubredditMeta('productivity');
    const t3ms = Date.now() - t3;
    console.log(
      `getSubredditMeta('productivity') again -> ${c ? `subscribers=${c.subscribers}` : 'null'} (${t3ms}ms, should be faster than first call)`,
    );

    console.log(
      `subredditMetaSource('productivity') -> tier=${subredditMetaSource('productivity').tier}, bias=${subredditMetaSource('productivity').bias}`,
    );
  })().catch((err) => {
    console.error('[reddit.ts self-check] error:', err);
    process.exit(1);
  });
}
