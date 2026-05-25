// GitHub REST client for public repository metadata.
//
// Auth: optional. With `GITHUB_TOKEN` set we get 5,000 req/hr. Without it,
// the same endpoints work at 60 req/hr (unauthenticated public limit).
// Unlike Serper/ProductHunt, we have no stub mode — the unauthenticated path
// IS the fallback; we just call it out in confidence_note.
//
// First user of GITHUB_TOKEN env var. Cached via src/lib/cache.ts (TTL.MEDIUM).

import { cacheGet, cacheSet, makeCacheKey, TTL } from './cache.js';
import type { ToolSource } from '../types.js';

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'product-validation-mcp/0.1.0';
const REQUEST_TIMEOUT_MS = 8_000;
const ENRICH_TOP_N = 5;

export interface GitHubRepoStats {
  full_name: string;
  stars: number;
  forks: number;
  open_issues: number;
  last_commit_at: string | null;
  days_since_last_commit: number | null;
  contributors_count: number | null;
  primary_language: string | null;
  description: string | null;
}

// ---- internal API response shapes (minimal projections) --------------------

interface SearchRepoItem {
  full_name: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  description: string | null;
  owner: { login: string };
  name: string;
}

interface SearchReposResponse {
  items: SearchRepoItem[];
}

interface RepoDetail {
  full_name: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  description: string | null;
  owner: { login: string };
  name: string;
}

interface CommitListItem {
  commit: {
    committer: { date: string } | null;
    author: { date: string } | null;
  };
}

// ---- header helpers --------------------------------------------------------

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env['GITHUB_TOKEN'];
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function ghFetch(path: string): Promise<Response> {
  const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
  return fetch(url, {
    headers: ghHeaders(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

// ---- enrichment ------------------------------------------------------------

/** Parse `Link: <...&page=42>; rel="last"` and return 42. Returns null if not present. */
function parseLastPage(linkHeader: string | null): number | null {
  if (!linkHeader) return null;
  // Look for rel="last"
  const lastSegment = linkHeader.split(',').find((s) => /rel="last"/.test(s));
  if (!lastSegment) return null;
  const match = lastSegment.match(/[?&]page=(\d+)/);
  if (!match) return null;
  const n = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(n) ? n : null;
}

async function fetchLatestCommitDate(owner: string, repo: string): Promise<string | null> {
  try {
    const res = await ghFetch(`/repos/${owner}/${repo}/commits?per_page=1`);
    if (!res.ok) return null;
    const data = (await res.json()) as CommitListItem[];
    const first = data[0];
    if (!first) return null;
    return first.commit.committer?.date ?? first.commit.author?.date ?? null;
  } catch (err) {
    console.error('[github.ts] fetchLatestCommitDate error:', err);
    return null;
  }
}

async function fetchContributorsCount(owner: string, repo: string): Promise<number | null> {
  try {
    const res = await ghFetch(`/repos/${owner}/${repo}/contributors?per_page=1&anon=true`);
    if (!res.ok) return null;
    const linkHeader = res.headers.get('Link');
    const lastPage = parseLastPage(linkHeader);
    if (lastPage !== null) return lastPage;
    // Link header absent → contributor list fits on the single page.
    const data = (await res.json()) as unknown[];
    return Array.isArray(data) ? data.length : null;
  } catch (err) {
    console.error('[github.ts] fetchContributorsCount error:', err);
    return null;
  }
}

function daysSince(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const t = new Date(isoDate).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

async function enrich(
  base: Omit<GitHubRepoStats, 'last_commit_at' | 'days_since_last_commit' | 'contributors_count'>,
  owner: string,
  repo: string,
): Promise<GitHubRepoStats> {
  const [last_commit_at, contributors_count] = await Promise.all([
    fetchLatestCommitDate(owner, repo),
    fetchContributorsCount(owner, repo),
  ]);
  return {
    ...base,
    last_commit_at,
    days_since_last_commit: daysSince(last_commit_at),
    contributors_count,
  };
}

// ---- public API ------------------------------------------------------------

export async function searchRepos(
  query: string,
  language?: string,
  limit = 10,
): Promise<GitHubRepoStats[]> {
  const cacheKey = makeCacheKey('github', query, language ?? 'all', String(limit));
  const cached = cacheGet<GitHubRepoStats[]>(cacheKey);
  if (cached) return cached;

  const qParts = [query];
  if (language) qParts.push(`language:${language}`);
  const params = new URLSearchParams({
    q: qParts.join(' '),
    sort: 'stars',
    order: 'desc',
    per_page: String(Math.min(Math.max(limit, 1), 100)),
  });

  try {
    const res = await ghFetch(`/search/repositories?${params.toString()}`);
    if (!res.ok) {
      console.error(`[github.ts] searchRepos: HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as SearchReposResponse;
    const items = data.items ?? [];

    // Build base stats from search payload (free; no extra API hits).
    const bases = items.map((it) => ({
      base: {
        full_name: it.full_name,
        stars: it.stargazers_count,
        forks: it.forks_count,
        open_issues: it.open_issues_count,
        primary_language: it.language,
        description: it.description,
      },
      owner: it.owner.login,
      repo: it.name,
    }));

    // Enrich only top N to respect API budget.
    const enriched: GitHubRepoStats[] = await Promise.all(
      bases.map(async ({ base, owner, repo }, idx) => {
        if (idx < ENRICH_TOP_N) {
          return enrich(base, owner, repo);
        }
        return {
          ...base,
          last_commit_at: null,
          days_since_last_commit: null,
          contributors_count: null,
        };
      }),
    );

    cacheSet(cacheKey, enriched, TTL.MEDIUM);
    return enriched;
  } catch (err) {
    console.error('[github.ts] searchRepos error:', err);
    return [];
  }
}

export async function getRepoStats(owner: string, repo: string): Promise<GitHubRepoStats | null> {
  const cacheKey = makeCacheKey('github-repo', owner, repo);
  const cached = cacheGet<GitHubRepoStats>(cacheKey);
  if (cached) return cached;

  try {
    const res = await ghFetch(`/repos/${owner}/${repo}`);
    if (!res.ok) {
      if (res.status !== 404) {
        console.error(`[github.ts] getRepoStats: HTTP ${res.status} for ${owner}/${repo}`);
      }
      return null;
    }
    const it = (await res.json()) as RepoDetail;
    const base = {
      full_name: it.full_name,
      stars: it.stargazers_count,
      forks: it.forks_count,
      open_issues: it.open_issues_count,
      primary_language: it.language,
      description: it.description,
    };
    const stats = await enrich(base, it.owner.login, it.name);
    cacheSet(cacheKey, stats, TTL.MEDIUM);
    return stats;
  } catch (err) {
    console.error('[github.ts] getRepoStats error:', err);
    return null;
  }
}

export function isGitHubLive(): boolean {
  return Boolean(process.env['GITHUB_TOKEN']);
}

export function githubSource(query: string): ToolSource {
  return {
    url: `${GITHUB_API}/search/repositories?q=${encodeURIComponent(query)}`,
    tier: 'S', // first-party API, raw repo data
    bias: 'independent', // GitHub has no stake in any specific product category
    fetched_at: new Date().toISOString(),
    contribution: `GitHub public repo metadata for: ${query}`,
  };
}

export function githubConfidenceNote(): string {
  return isGitHubLive()
    ? 'GitHub data is live (5000 req/hr authenticated).'
    : 'GitHub fallback: unauthenticated 60 req/hr. Set GITHUB_TOKEN for higher rate limit.';
}

// ---- self-check ------------------------------------------------------------

const isDirectRun = (() => {
  try {
    // Resolve current file path from import.meta.url and compare to argv[1].
    const here = new URL(import.meta.url).pathname;
    const invoked = process.argv[1] ?? '';
    return here === invoked || here.endsWith(invoked) || invoked.endsWith(here);
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  (async () => {
    console.log('[github.ts self-check]');
    const live = isGitHubLive();
    console.log(`isGitHubLive(): ${live} (boolean? ${typeof live === 'boolean'})`);
    console.log(`confidenceNote: ${githubConfidenceNote()}`);
    if (live) {
      const results = await searchRepos('focus productivity', 'typescript', 3);
      console.log(`searchRepos returned ${results.length} repos`);
      const first = results[0];
      if (first) {
        console.log(`first: ${first.full_name}`);
        console.log(`first.stars: ${first.stars}`);
        console.log(`first.days_since_last_commit: ${first.days_since_last_commit}`);
      } else {
        console.log('first: <none>');
      }
    } else {
      console.log('GITHUB_TOKEN not set — skipping live test');
    }
  })().catch((err) => {
    console.error('[github.ts self-check] error:', err);
    process.exit(1);
  });
}
