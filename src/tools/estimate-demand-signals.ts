// estimate_demand_signals — Gate 2 (Market Demand) primary tool.
//
// Composes three signal sources to produce a single demand verdict:
//   1. GitHub repo stats (tier S, bias independent — first-party platform data,
//      GitHub has no stake in any specific product category).
//   2. Reddit subreddit metadata via the no-auth about.json path
//      (tier A, bias independent — first-party Reddit aggregated count).
//   3. Launch-cluster signal via Serper site-scoped search across
//      ProductHunt + TechCrunch (tier B, bias independent — third-party aggregator).
//
// Explicitly DEFERRED for v1 (see plan T12c + CONCERNS.md H6):
//   - Google Trends API (no stable public API).
//   - SimilarWeb / competitor traffic (paid; no key in this build).
// Both are noted in confidence_note when relevant.
//
// Output: ToolResult<EstimateDemandSignalsData> where data carries
// per-signal-type structured payloads plus a gate2_signal_strength
// (strong / moderate / weak / none) and a short verdict tying it to Gate 2.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult, ToolSource } from '../types.js';
import { okResult } from '../lib/envelope.js';
import { isRelevant, buildRelevanceTerms } from '../lib/relevance.js';
import {
  searchRepos,
  isGitHubLive,
  githubSource,
  type GitHubRepoStats,
} from '../lib/github.js';
import {
  getSubredditMeta,
  subredditMetaSource,
  type SubredditMeta,
} from '../lib/reddit.js';
import {
  serperSearch,
  isSerperLive,
  serperSource,
  type SerperOrganicResult,
} from '../lib/serper.js';
import { effectiveBias, requiresUpgradeFromUnknown } from '../lib/bias.js';
import { cacheGet, cacheSet, makeCacheKey, TTL } from '../lib/cache.js';

type SignalStrength = 'strong' | 'moderate' | 'weak' | 'none';

interface GitHubSignals {
  top_repos: GitHubRepoStats[];
  total_stars_top5: number;
  avg_days_since_last_commit: number | null;
  languages_seen: string[];
  /** Phase 10 — repos dropped as off-topic keyword matches before scoring. */
  filtered_off_topic_count: number;
}

interface SubredditSignal {
  name: string;
  subscribers: number;
  active_user_count: number | null;
  recency_days: number | null;
}

interface RedditSignals {
  subreddits: SubredditSignal[];
}

interface SampleLaunch {
  title: string;
  url: string;
  snippet: string;
}

interface LaunchClusterSignals {
  recent_launches_count: number;
  sample_launches: SampleLaunch[];
}

interface EstimateDemandSignalsData {
  github_signals: GitHubSignals;
  reddit_signals: RedditSignals;
  launch_cluster_signals: LaunchClusterSignals;
  gate2_signal_strength: SignalStrength;
  verdict: string;
}

const LAUNCH_SITES = ['producthunt.com', 'techcrunch.com'];
const CURRENT_YEAR = new Date().getFullYear();
const RECENT_YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1];

const STRONG_REPO_STARS = 1000;
const STRONG_REPO_ACTIVE_DAYS = 30;
const STRONG_SUB_SUBSCRIBERS = 10_000;
const STRONG_LAUNCH_COUNT = 3;
const MODERATE_REPO_STARS = 500;
const MODERATE_SUB_SUBSCRIBERS = 1_000;

// ───────────────────────────────────────────────────────────────────────────
// Heuristic default-derivation helpers
//
// When the caller doesn't pass explicit candidate_subreddits / candidate_repos
// we generate plausible defaults from the category string. These are
// best-effort — the LLM should pass explicit candidates whenever possible,
// and confidence_note discloses when defaults were used.
// ───────────────────────────────────────────────────────────────────────────

function deriveCandidateSubreddits(category: string): string[] {
  const cleaned = category.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  if (!cleaned) return [];
  const firstWord = cleaned.split(/\s+/)[0] ?? '';
  const collapsed = cleaned.replace(/\s+/g, '');
  const variants = new Set<string>();
  if (firstWord) variants.add(firstWord);
  if (collapsed && collapsed !== firstWord) variants.add(collapsed);
  // Cap at 3 to respect API budget; about.json is no-auth but still a real call.
  return Array.from(variants).slice(0, 3);
}

// ───────────────────────────────────────────────────────────────────────────
// Signal-strength heuristic — see plan T12c "Scoring heuristic" block.
// ───────────────────────────────────────────────────────────────────────────

function scoreSignalStrength(
  github: GitHubSignals,
  reddit: RedditSignals,
  launches: LaunchClusterSignals,
): SignalStrength {
  const topRepo = github.top_repos[0];
  const topRepoStrong =
    !!topRepo &&
    topRepo.stars >= STRONG_REPO_STARS &&
    topRepo.days_since_last_commit !== null &&
    topRepo.days_since_last_commit <= STRONG_REPO_ACTIVE_DAYS;
  const bigSub = reddit.subreddits.some(
    (s) => s.subscribers >= STRONG_SUB_SUBSCRIBERS,
  );
  const launchStrong = launches.recent_launches_count >= STRONG_LAUNCH_COUNT;

  if (topRepoStrong && bigSub && launchStrong) return 'strong';

  // Moderate: any two of the weaker thresholds.
  const moderateRepo = github.top_repos.some(
    (r) => r.stars >= MODERATE_REPO_STARS,
  );
  const moderateSub = reddit.subreddits.some(
    (s) => s.subscribers >= MODERATE_SUB_SUBSCRIBERS,
  );
  const moderateLaunch = launches.recent_launches_count >= 1;
  const moderateHits = [moderateRepo, moderateSub, moderateLaunch].filter(
    Boolean,
  ).length;
  if (moderateHits >= 2) return 'moderate';

  // Weak: isolated signal in only one dimension.
  if (moderateHits === 1) return 'weak';

  return 'none';
}

// ───────────────────────────────────────────────────────────────────────────
// Phase fetchers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Relevance gate for the GitHub demand signal — drops repos that match only a
 * generic category word (Quivr/"focus", Joplin/"focused") so they don't
 * inflate the signal. Phase 11: the matching logic lives in src/lib/relevance.ts;
 * this thin wrapper adapts a repo object to the shared isRelevant(). Re-exported
 * (with buildRelevanceTerms) for the tool's unit tests.
 */
export function isRepoRelevant(
  repo: Pick<GitHubRepoStats, 'full_name' | 'description'>,
  relevanceTerms: string[],
  categoryPhrase: string,
): boolean {
  return isRelevant(`${repo.full_name} ${repo.description ?? ''}`, relevanceTerms, categoryPhrase);
}
export { buildRelevanceTerms };

async function fetchGitHubSignals(
  candidateRepos: string[],
  category: string,
  categoryKeywords: string[],
): Promise<GitHubSignals> {
  // Strategy: each candidate query → searchRepos(query, undefined, 5). Then
  // pool, dedupe by full_name, sort by stars desc, keep top 5. If no
  // candidates passed, use the category as the single query.
  const queries = candidateRepos.length > 0 ? candidateRepos : [category];
  const settled = await Promise.allSettled(
    queries.map((q) => searchRepos(q, undefined, 5)),
  );

  const byName = new Map<string, GitHubRepoStats>();
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const repo of r.value) {
      const existing = byName.get(repo.full_name);
      // Keep the entry with richer enrichment (commit date present) if duplicated.
      if (!existing || (existing.last_commit_at === null && repo.last_commit_at !== null)) {
        byName.set(repo.full_name, repo);
      }
    }
  }

  // Phase 10 — relevance filter before the signal is computed. Off-topic
  // keyword matches are excluded so total_stars / topRepo reflect the actual
  // category, not whatever GitHub returned for a shared generic word.
  const relevanceTerms = buildRelevanceTerms(category, categoryKeywords);
  const pooledAll = Array.from(byName.values());
  const pooled = pooledAll
    .filter((r) => isRepoRelevant(r, relevanceTerms, category.toLowerCase()))
    .sort((a, b) => b.stars - a.stars);
  const filtered_off_topic_count = pooledAll.length - pooled.length;
  const top = pooled.slice(0, 5);

  const total_stars_top5 = top.reduce((sum, r) => sum + r.stars, 0);
  const withDays = top.filter((r) => r.days_since_last_commit !== null);
  const avg_days_since_last_commit =
    withDays.length > 0
      ? Math.round(
          withDays.reduce((sum, r) => sum + (r.days_since_last_commit ?? 0), 0) /
            withDays.length,
        )
      : null;

  const languages_seen = Array.from(
    new Set(
      top
        .map((r) => r.primary_language)
        .filter((l): l is string => typeof l === 'string' && l.length > 0),
    ),
  );

  return { top_repos: top, total_stars_top5, avg_days_since_last_commit, languages_seen, filtered_off_topic_count };
}

async function fetchRedditSignals(
  candidateSubreddits: string[],
): Promise<{ signals: RedditSignals; resolvedCount: number; attemptedCount: number }> {
  const attempted = candidateSubreddits;
  const settled = await Promise.allSettled(
    attempted.map((name) => getSubredditMeta(name)),
  );

  const now = Date.now();
  const subreddits: SubredditSignal[] = [];
  let resolvedCount = 0;
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    const name = attempted[i] ?? '';
    if (s?.status !== 'fulfilled' || s.value === null) continue;
    const meta: SubredditMeta = s.value;
    resolvedCount++;
    const recency_days =
      meta.created_utc > 0
        ? Math.floor((now / 1000 - meta.created_utc) / 86_400)
        : null;
    subreddits.push({
      name: meta.name || name,
      subscribers: meta.subscribers,
      active_user_count: meta.active_user_count,
      recency_days,
    });
  }

  return {
    signals: { subreddits },
    resolvedCount,
    attemptedCount: attempted.length,
  };
}

async function fetchLaunchClusterSignals(
  category: string,
): Promise<LaunchClusterSignals> {
  // Single Serper query — site-scoped to PH + TC, year-scoped to recent.
  const yearScope = RECENT_YEARS.join(' OR ');
  const siteScope = LAUNCH_SITES.map((s) => `site:${s}`).join(' OR ');
  const query = `${category} launched ${yearScope} ${siteScope}`;
  let results: SerperOrganicResult[] = [];
  try {
    results = await serperSearch(query, 5);
  } catch {
    results = [];
  }

  // Filter out [STUB] markers explicitly — when Serper isn't live, we
  // surface nothing here rather than count stub rows as real launches.
  const real = isSerperLive()
    ? results.filter((r) => !r.title.startsWith('[STUB]'))
    : [];

  return {
    recent_launches_count: real.length,
    sample_launches: real.slice(0, 5).map((r) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
    })),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Tool registration
// ───────────────────────────────────────────────────────────────────────────

export function registerEstimateDemandSignals(server: McpServer): void {
  server.registerTool(
    'estimate_demand_signals',
    {
      description:
        "Assess Gate 2 (Market Demand) — composes GitHub repo activity, Reddit subreddit subscriber counts, and Serper-aggregated launch-cluster mentions into a single gate2_signal_strength (strong/moderate/weak/none) plus a verdict. Google Trends + SimilarWeb are explicitly deferred in v1. Envelope: { status: 'ok'|'honest_gap'|'error', data, sources, confidence_note, fallbacks_used, error? }. status='honest_gap' = ran cleanly, no substantive data found (evidence gap, not failure).",
      inputSchema: {
        idea_description: z
          .string()
          .describe('Plain-language description of the product idea — used for context only, not directly searched'),
        category: z
          .string()
          .describe('Product category — e.g. "focus app", "AI writing assistant", "habit tracker"'),
        category_keywords: z
          .array(z.string())
          .optional()
          .describe('Optional extra keywords to narrow searches, e.g. ["screen time", "deep work"]'),
        candidate_subreddits: z
          .array(z.string())
          .optional()
          .describe('Optional explicit subreddit names (without the r/ prefix). If omitted, 2-3 plausible names are derived from category — pass explicit values when possible.'),
        candidate_repos: z
          .array(z.string())
          .optional()
          .describe('Optional explicit GitHub search queries. If omitted, the category itself is used — pass explicit values when possible.'),
      },
    },
    async ({
      idea_description: _idea_description,
      category,
      category_keywords,
      candidate_subreddits,
      candidate_repos,
    }) => {
      void _idea_description; // currently context-only; reserved for future query shaping
      // Tool-layer cache: TTL.SHORT (5min). Composes GitHub (LIB-CACHED) +
      // Reddit (LIB-CACHED) + Serper (NOT-CACHED). The outer wrap is the
      // ONLY cache that protects the Serper fan-out from refiring on repeat
      // invocations within a session. Inner lib caches persist beyond the
      // 5-minute outer TTL (GitHub/Reddit memoize at their own TTLs), so
      // when the outer expires re-runs still avoid GitHub API rate-limit
      // burns — only Serper retries.
      const keywordsForKey = (category_keywords ?? []).map((k) => k.trim().toLowerCase()).sort();
      const subsForKey = (candidate_subreddits ?? []).map((s) => s.trim().toLowerCase()).sort();
      const reposForKey = (candidate_repos ?? []).map((r) => r.trim().toLowerCase()).sort();
      const cacheKey = makeCacheKey(
        'estimate_demand_signals',
        category.trim().toLowerCase(),
        keywordsForKey.join(','),
        subsForKey.join(','),
        reposForKey.join(','),
      );
      const cached = cacheGet<ToolResult<EstimateDemandSignalsData>>(cacheKey);
      if (cached) {
        return { content: [{ type: 'text', text: JSON.stringify(cached, null, 2) }] };
      }

      const sources: ToolSource[] = [];
      const fallbacksUsed: string[] = [];
      const keywords = category_keywords ?? [];
      const githubQueries = candidate_repos ?? [];
      const subredditsRequested = candidate_subreddits;
      const subredditCandidates =
        subredditsRequested && subredditsRequested.length > 0
          ? subredditsRequested
          : deriveCandidateSubreddits(category);
      const usedDerivedSubs = !subredditsRequested || subredditsRequested.length === 0;
      const usedDerivedRepos = githubQueries.length === 0;

      // Parallel fan-out across the three signal types — Promise.allSettled
      // matches the existing pattern in check-big-tech-encroachment.ts.
      const [githubSettled, redditSettled, launchSettled] = await Promise.allSettled([
        fetchGitHubSignals(githubQueries, category, keywords),
        fetchRedditSignals(subredditCandidates),
        fetchLaunchClusterSignals([category, ...keywords].join(' ')),
      ]);

      const githubData: GitHubSignals =
        githubSettled.status === 'fulfilled'
          ? githubSettled.value
          : { top_repos: [], total_stars_top5: 0, avg_days_since_last_commit: null, languages_seen: [], filtered_off_topic_count: 0 };
      const redditData =
        redditSettled.status === 'fulfilled'
          ? redditSettled.value
          : { signals: { subreddits: [] }, resolvedCount: 0, attemptedCount: subredditCandidates.length };
      const launchData: LaunchClusterSignals =
        launchSettled.status === 'fulfilled'
          ? launchSettled.value
          : { recent_launches_count: 0, sample_launches: [] };

      // ─── Source attribution ─────────────────────────────────────────────
      // GitHub: one source per query that contributed at least one repo,
      // OR a single placeholder source if nothing came back (so the bias
      // mix still reflects the attempted fetch).
      if (githubData.top_repos.length > 0) {
        // Attribute to the first query that returned any repo — keeps sources[]
        // compact; the contribution text names the actual returned repos.
        const queriesForAttribution = githubQueries.length > 0 ? githubQueries : [category];
        sources.push(githubSource(queriesForAttribution.join(' | ')));
      }

      // Reddit: one source per resolved subreddit (each is a distinct fetch).
      for (const sub of redditData.signals.subreddits) {
        sources.push(subredditMetaSource(sub.name));
      }

      // Launch cluster: one Serper source if we attempted it.
      // serperSource() already tags tier B/independent when live, D/unknown when stubbed.
      sources.push(
        serperSource(`${category} launched ${RECENT_YEARS.join(' OR ')} ${LAUNCH_SITES.map((s) => `site:${s}`).join(' OR ')}`),
      );

      // ─── Fallbacks ──────────────────────────────────────────────────────
      if (!isGitHubLive()) {
        fallbacksUsed.push(
          'github (unauthenticated 60 req/hr — set GITHUB_TOKEN for higher)',
        );
      }
      if (!isSerperLive()) {
        fallbacksUsed.push('serper (stub — set SERPER_API_KEY)');
      }
      // SimilarWeb is unconditionally deferred in v1 per plan T12c — surface it
      // honestly in fallbacks_used so callers can see the missing dimension.
      fallbacksUsed.push(
        'similarweb (deferred in v1 — competitor traffic dimension unavailable)',
      );

      // ─── Scoring + verdict ──────────────────────────────────────────────
      const gate2SignalStrength = scoreSignalStrength(githubData, redditData.signals, launchData);

      const topRepo = githubData.top_repos[0];
      const topRepoBlurb = topRepo
        ? `top GitHub repo ${topRepo.full_name} @ ${topRepo.stars}★${topRepo.days_since_last_commit !== null ? ` (${topRepo.days_since_last_commit}d since last commit)` : ''}`
        : 'no GitHub repos surfaced';
      const subBlurb =
        redditData.signals.subreddits.length > 0
          ? `${redditData.signals.subreddits.length} subreddit(s) resolved (largest: ${Math.max(...redditData.signals.subreddits.map((s) => s.subscribers)).toLocaleString()} subscribers)`
          : 'no subreddit metadata available';
      const launchBlurb = `${launchData.recent_launches_count} recent launch mention(s) on PH/TC`;

      let verdict: string;
      switch (gate2SignalStrength) {
        case 'strong':
          verdict = `Gate 2 PASS likely. Strong demand: ${topRepoBlurb}; ${subBlurb}; ${launchBlurb}. Multiple converging signals — community, code, and launch activity all align.`;
          break;
        case 'moderate':
          verdict = `Gate 2 CONDITIONAL. Moderate demand: ${topRepoBlurb}; ${subBlurb}; ${launchBlurb}. Real signal but not unambiguous — corroborate with find_public_revenue_signals before committing.`;
          break;
        case 'weak':
          verdict = `Gate 2 WEAK. Isolated demand signal: ${topRepoBlurb}; ${subBlurb}; ${launchBlurb}. Single-dimension evidence — broaden candidate_subreddits / candidate_repos and re-run, or treat as insufficient.`;
          break;
        default:
          verdict = `Gate 2 FAIL likely. No meaningful demand: ${topRepoBlurb}; ${subBlurb}; ${launchBlurb}. Either category is dormant or search terms missed the relevant communities — pass explicit candidate_subreddits + candidate_repos and retry before concluding.`;
      }

      // ─── confidence_note — honest accounting per spec §4 rule 4 ─────────
      const unknownCount = requiresUpgradeFromUnknown(sources);
      const conflictedCount = sources.filter(
        (s) => effectiveBias(s.bias) === 'conflicted',
      ).length;
      const independentCount = sources.filter(
        (s) => effectiveBias(s.bias) === 'independent',
      ).length;

      const confidenceParts: string[] = [];
      confidenceParts.push(
        `GitHub: ${isGitHubLive() ? 'live (authenticated)' : 'unauthenticated 60 req/hr'}; surfaced ${githubData.top_repos.length} on-topic repo(s) across ${githubQueries.length || 1} query/queries${githubData.filtered_off_topic_count > 0 ? ` (excluded ${githubData.filtered_off_topic_count} off-topic keyword match(es) from the signal)` : ''}.`,
      );
      confidenceParts.push(
        `Reddit: ${redditData.resolvedCount}/${redditData.attemptedCount} candidate subreddits resolved (null = doesn't exist or private).`,
      );
      if (usedDerivedSubs && subredditCandidates.length > 0) {
        confidenceParts.push(
          `Subreddit candidates were derived from category heuristically (${subredditCandidates.join(', ')}) — pass explicit candidate_subreddits for better coverage.`,
        );
      }
      if (usedDerivedRepos) {
        confidenceParts.push(
          'GitHub query used category as-is — pass explicit candidate_repos for tighter signal.',
        );
      }
      confidenceParts.push(
        `Launch cluster: ${isSerperLive() ? 'live' : 'stub (no SERPER_API_KEY)'}; ${launchData.recent_launches_count} non-stub launches in window.`,
      );
      confidenceParts.push(
        'Google Trends + SimilarWeb dimensions deferred in v1 (see fallbacks_used) — verdict is based on code/community/launch signals only.',
      );
      confidenceParts.push(
        `Source mix: ${independentCount} independent, ${conflictedCount} conflicted${unknownCount > 0 ? `, ${unknownCount} unknown→vendor-funded for math (spec §4 rule 4)` : ''}.`,
      );

      const result: ToolResult<EstimateDemandSignalsData> = okResult(
        {
          github_signals: githubData,
          reddit_signals: redditData.signals,
          launch_cluster_signals: launchData,
          gate2_signal_strength: gate2SignalStrength,
          verdict,
        },
        sources,
        confidenceParts.join(' '),
        fallbacksUsed,
      );

      cacheSet(cacheKey, result, TTL.SHORT);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
