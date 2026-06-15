// find_public_revenue_signals — Gate 2 (Market Demand) + Gate 4 (WTP) P1 tool.
//
// Surfaces public revenue evidence from comparable products across four families:
//   1. IndieHackers public revenue entries  (tier A, bias independent)
//   2. Founder MRR / ARR tweets on x.com   (tier A, bias conflicted — founder stake)
//   3. SEC 10-K / S-1 / 10-Q filings        (tier S, bias independent — regulatory)
//   4. OpenStartup transparency pages       (tier S, bias conflicted — founder-published)
//
// Per spec §7 entry, §4 tier-bias rules, §11 anti-pattern 2 (never fabricate).
//
// Source-bias note (spec §4 rule 6): first-person founder claims (tweets, OpenStartup
// pages) get `conflicted` because the founder has a stake in favorable framing,
// even though the numbers themselves are usually genuine. SEC filings are regulatory
// (sworn under penalty) so they're `independent`. IndieHackers entries are
// user-submitted but transparent and not directly self-promoted — `independent`.
//
// Budget: ≤4 Serper calls per invocation (one per family). Per-competitor IH
// searches are capped at 5 competitors per spec budget guidance.
//
// Honest empties: SEC filings often return nothing for SMB SaaS — that's surfaced
// in confidence_note, not fabricated.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult, ToolSource } from '../types.js';
import { okResult, honestGapResult } from '../lib/envelope.js';
import {
  serperSearch,
  isSerperLive,
  type SerperOrganicResult,
} from '../lib/serper.js';
import { effectiveBias, requiresUpgradeFromUnknown } from '../lib/bias.js';
import { cacheGet, cacheSet, makeCacheKey, TTL } from '../lib/cache.js';

type SignalStrength = 'strong' | 'moderate' | 'weak' | 'none';

interface IndieHackersEntry {
  company: string;
  mrr: string;
  url: string;
  snippet: string;
}

interface FounderMrrTweet {
  author: string;
  claim: string;
  url: string;
}

interface SecFiling {
  company: string;
  filing_type: string;
  url: string;
}

interface OpenStartupEntry {
  company: string;
  url: string;
  snippet: string;
}

interface RevenueSummary {
  paid_comparables_count: number;
  highest_observed_mrr: string | null;
  sample_arr_range: string | null;
}

interface FindPublicRevenueSignalsData {
  indiehackers_entries: IndieHackersEntry[];
  founder_mrr_tweets: FounderMrrTweet[];
  sec_filings: SecFiling[];
  openstartup_entries: OpenStartupEntry[];
  revenue_summary: RevenueSummary;
  gate2_wtp_signal_strength: SignalStrength;
  verdict: string;
}

const MAX_COMPETITORS_FOR_IH = 5;

// ───────────────────────────────────────────────────────────────────────────
// Revenue-number parsing — opportunistic, never fabricates.
// Patterns recognized in titles/snippets:
//   "$10k/mo", "$10k MRR", "10k/month", "$1.2M ARR", "$1.2M/year"
// Returns null if no pattern matched (caller should surface raw snippet).
// ───────────────────────────────────────────────────────────────────────────

const MRR_PATTERNS: RegExp[] = [
  /\$\s?(\d+(?:\.\d+)?)\s?([kKmM])\s?\/?\s?(?:mo|month|MRR)/,
  /\$\s?(\d+(?:\.\d+)?)\s?([kKmM])\s?MRR/i,
  /(\d+(?:\.\d+)?)\s?([kKmM])\s?\/\s?(?:mo|month)/i,
  /\$\s?(\d+(?:,\d{3})+)\s?MRR/i,
];

const ARR_PATTERNS: RegExp[] = [
  /\$\s?(\d+(?:\.\d+)?)\s?([kKmMbB])\s?(?:\/?\s?(?:yr|year)|ARR)/i,
];

function extractMrrString(text: string): string | null {
  for (const re of MRR_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

function extractArrString(text: string): string | null {
  for (const re of ARR_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

// Compare two MRR strings approximately by normalizing to a dollar number.
// Returns NaN for unparseable strings — caller should treat as "unknown".
function mrrToDollars(s: string): number {
  const m = /\$?\s?(\d+(?:\.\d+)?|\d+(?:,\d{3})+)\s?([kKmMbB])?/.exec(s);
  if (!m) return NaN;
  const numRaw = (m[1] ?? '').replace(/,/g, '');
  const num = Number(numRaw);
  if (!Number.isFinite(num)) return NaN;
  const mult = (m[2] ?? '').toLowerCase();
  if (mult === 'k') return num * 1_000;
  if (mult === 'm') return num * 1_000_000;
  if (mult === 'b') return num * 1_000_000_000;
  return num;
}

// ───────────────────────────────────────────────────────────────────────────
// Fetchers — one per source family.
// All defensive: empty array on error rather than throwing.
// ───────────────────────────────────────────────────────────────────────────

async function fetchIndieHackers(
  competitors: string[],
  category: string,
): Promise<IndieHackersEntry[]> {
  // Strategy: one combined query covering the category + first few competitors.
  // Spec budget: stay at 1 Serper call for this family.
  const capped = competitors.slice(0, MAX_COMPETITORS_FOR_IH);
  const competitorScope =
    capped.length > 0 ? `(${capped.map((c) => `"${c}"`).join(' OR ')})` : `"${category}"`;
  const query = `${competitorScope} ${category} revenue OR MRR site:indiehackers.com`;

  let results: SerperOrganicResult[] = [];
  try {
    results = await serperSearch(query, 10);
  } catch {
    return [];
  }
  if (!isSerperLive()) return [];

  const entries: IndieHackersEntry[] = [];
  for (const r of results) {
    if (r.title.startsWith('[STUB]')) continue;
    // Heuristic: match the result to whichever competitor (or the category) appears.
    const haystack = `${r.title} ${r.snippet}`.toLowerCase();
    const matchedCompetitor = capped.find((c) =>
      haystack.includes(c.toLowerCase()),
    );
    const company = matchedCompetitor ?? extractCompanyFromTitle(r.title) ?? category;
    const mrr = extractMrrString(`${r.title} ${r.snippet}`) ?? '';
    entries.push({ company, mrr, url: r.link, snippet: r.snippet });
  }
  return entries;
}

async function fetchFounderTweets(
  competitors: string[],
  category: string,
): Promise<FounderMrrTweet[]> {
  // One combined query — anchored on category + first competitor for relevance.
  const firstCompetitor = competitors[0] ?? '';
  const anchor = firstCompetitor
    ? `"${category}" OR "${firstCompetitor}"`
    : `"${category}"`;
  const query = `${anchor} ("MRR" OR "monthly recurring revenue") site:x.com OR site:twitter.com`;

  let results: SerperOrganicResult[] = [];
  try {
    results = await serperSearch(query, 5);
  } catch {
    return [];
  }
  if (!isSerperLive()) return [];

  const tweets: FounderMrrTweet[] = [];
  for (const r of results) {
    if (r.title.startsWith('[STUB]')) continue;
    const author = extractTwitterAuthor(r.link) ?? r.title.split(' on X')[0] ?? 'unknown';
    tweets.push({
      author,
      claim: r.snippet || r.title,
      url: r.link,
    });
  }
  return tweets;
}

async function fetchSecFilings(category: string): Promise<SecFiling[]> {
  const query = `${category} 10-K OR S-1 OR 10-Q site:sec.gov`;

  let results: SerperOrganicResult[] = [];
  try {
    results = await serperSearch(query, 5);
  } catch {
    return [];
  }
  if (!isSerperLive()) return [];

  const filings: SecFiling[] = [];
  for (const r of results) {
    if (r.title.startsWith('[STUB]')) continue;
    const filing_type = inferFilingType(r.title) ?? 'filing';
    const company = extractCompanyFromTitle(r.title) ?? 'unknown';
    filings.push({ company, filing_type, url: r.link });
  }
  return filings;
}

async function fetchOpenStartup(category: string): Promise<OpenStartupEntry[]> {
  // OpenStartup transparency pages live across many domains; the "openstartup"
  // term + general search is more reliable than a single domain filter.
  // Spec §7 allowed either approach.
  const query = `${category} open startup MRR transparency site:openstartup.com OR "open-startups" OR "open startup"`;

  let results: SerperOrganicResult[] = [];
  try {
    results = await serperSearch(query, 5);
  } catch {
    return [];
  }
  if (!isSerperLive()) return [];

  const entries: OpenStartupEntry[] = [];
  for (const r of results) {
    if (r.title.startsWith('[STUB]')) continue;
    const company = extractCompanyFromTitle(r.title) ?? 'unknown';
    entries.push({ company, url: r.link, snippet: r.snippet });
  }
  return entries;
}

// ───────────────────────────────────────────────────────────────────────────
// Small string helpers — keep heuristics dumb + safe.
// ───────────────────────────────────────────────────────────────────────────

function extractCompanyFromTitle(title: string): string | null {
  // Heuristic: take text before the first "—", "|", "-", or " on ".
  const m = /^([^—|\-]+?)(?:\s+[—|\-]\s+|\s+on\s+|\s+\(|$)/.exec(title.trim());
  const candidate = m?.[1]?.trim();
  if (candidate && candidate.length > 0 && candidate.length <= 60) return candidate;
  return null;
}

function extractTwitterAuthor(url: string): string | null {
  const m = /(?:x\.com|twitter\.com)\/([^\/\?#]+)/i.exec(url);
  return m?.[1] ? `@${m[1]}` : null;
}

function inferFilingType(title: string): string | null {
  if (/10-K/i.test(title)) return '10-K';
  if (/10-Q/i.test(title)) return '10-Q';
  if (/S-1/i.test(title)) return 'S-1';
  if (/8-K/i.test(title)) return '8-K';
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Source attribution — each family contributes one ToolSource if attempted.
// Tier + bias per spec §4.
// ───────────────────────────────────────────────────────────────────────────

function mkSerperFamilySource(
  family: string,
  query: string,
  tier: ToolSource['tier'],
  bias: ToolSource['bias'],
  contributionDetail: string,
): ToolSource {
  const live = isSerperLive();
  return {
    url: `https://google.serper.dev/search?q=${encodeURIComponent(query)}`,
    tier: live ? tier : 'D',
    bias: live ? bias : 'unknown',
    fetched_at: new Date().toISOString(),
    contribution: live
      ? `[${family}] ${contributionDetail}`
      : `[STUB ${family}] no SERPER_API_KEY — placeholder; ${contributionDetail}`,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Summary + scoring per plan §T14.
// ───────────────────────────────────────────────────────────────────────────

const STRONG_IH_COUNT = 3;
const STRONG_IH_MRR_DOLLARS = 10_000;
const STRONG_ARR_DOLLARS_PUBLIC = 100_000_000;

function summarize(
  ih: IndieHackersEntry[],
  tweets: FounderMrrTweet[],
  sec: SecFiling[],
  os: OpenStartupEntry[],
): RevenueSummary {
  const paidComparablesCount =
    ih.filter((e) => e.mrr.length > 0).length +
    sec.length +
    os.filter((e) => /\$/.test(e.snippet)).length;

  // Highest observed MRR — across IH entries + tweet claims.
  let highest: { str: string; dollars: number } | null = null;
  const considerMrr = (raw: string): void => {
    const dollars = mrrToDollars(raw);
    if (!Number.isFinite(dollars)) return;
    if (!highest || dollars > highest.dollars) {
      highest = { str: raw, dollars };
    }
  };
  for (const e of ih) if (e.mrr) considerMrr(e.mrr);
  for (const t of tweets) {
    const mrr = extractMrrString(t.claim);
    if (mrr) considerMrr(mrr);
  }
  const highestStr: string | null = highest !== null ? (highest as { str: string }).str : null;

  // ARR range — pulled from SEC + tweet snippets if any ARR phrasing.
  const arrHits: number[] = [];
  for (const t of tweets) {
    const arr = extractArrString(t.claim);
    if (arr) {
      const d = mrrToDollars(arr);
      if (Number.isFinite(d)) arrHits.push(d);
    }
  }
  let sampleArrRange: string | null = null;
  if (arrHits.length > 0) {
    const min = Math.min(...arrHits);
    const max = Math.max(...arrHits);
    sampleArrRange = min === max ? formatDollars(min) : `${formatDollars(min)} – ${formatDollars(max)}`;
  }

  return {
    paid_comparables_count: paidComparablesCount,
    highest_observed_mrr: highestStr,
    sample_arr_range: sampleArrRange,
  };
}

function formatDollars(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n}`;
}

function scoreSignal(
  ih: IndieHackersEntry[],
  tweets: FounderMrrTweet[],
  sec: SecFiling[],
  summary: RevenueSummary,
): SignalStrength {
  // Strong: ≥3 IH with $10k+ MRR, OR ≥1 SEC filing showing $100M+ ARR signal,
  // OR clear public ARR figure from $1B+ company.
  const ihWithBigMrr = ih.filter((e) => {
    const d = mrrToDollars(e.mrr);
    return Number.isFinite(d) && d >= STRONG_IH_MRR_DOLLARS;
  }).length;

  const highestDollars = summary.highest_observed_mrr
    ? mrrToDollars(summary.highest_observed_mrr)
    : NaN;
  const strongPublicArr =
    sec.length > 0 && Number.isFinite(highestDollars) && highestDollars * 12 >= STRONG_ARR_DOLLARS_PUBLIC;

  if (ihWithBigMrr >= STRONG_IH_COUNT) return 'strong';
  if (strongPublicArr) return 'strong';

  // Moderate: 1-2 IH entries with verifiable MRR OR converging tweet MRR claims.
  const ihWithAnyMrr = ih.filter((e) => e.mrr.length > 0).length;
  const tweetsWithMrr = tweets.filter((t) => extractMrrString(t.claim) !== null).length;
  if (ihWithAnyMrr >= 1 || tweetsWithMrr >= 2) return 'moderate';

  // Weak: scattered references, no concrete numbers but some signal.
  if (ih.length > 0 || tweets.length > 0 || sec.length > 0) return 'weak';

  return 'none';
}

// ───────────────────────────────────────────────────────────────────────────
// Tool registration
// ───────────────────────────────────────────────────────────────────────────

export function registerFindPublicRevenueSignals(server: McpServer): void {
  server.registerTool(
    'find_public_revenue_signals',
    {
      description:
        'Surface public revenue evidence (IndieHackers entries, founder MRR tweets, SEC filings, OpenStartup pages) for a product category and its competitors. Strengthens Gate 2 (market demand via paid comparables) and Gate 4 (WTP via observed price points). Returns gate2_wtp_signal_strength + verdict. Never fabricates: empty arrays mean nothing surfaced.',
      inputSchema: {
        category: z
          .string()
          .describe('Product category, e.g. "focus app", "AI writing assistant"'),
        competitors: z
          .array(z.string())
          .describe('Competitor / product names to look up by name (capped at 5 for the IndieHackers search)'),
        framing: z
          .object({
            audience: z.enum(['B2B', 'B2C', 'B2B2C', 'dev_tools']),
            builder: z.enum(['solo', 'small_team', 'funded']),
          })
          .optional()
          .describe('Optional framing — adapts which signal families weigh heavier in the verdict text'),
      },
    },
    async ({ category, competitors, framing }) => {
      // Tool-layer cache: TTL.SHORT (5min). Runs 4 Serper site-filter fan-outs
      // (TechCrunch / Crunchbase / SEC / IndieHackers) per competitor; Serper
      // has NO internal cache. The `framing` object is deliberately omitted
      // from the cache key — per PLAN §T12, framing only adjusts auto_flags
      // downstream and does not influence the fetched evidence, so a cache
      // hit across framings is safe. (framing is still used downstream for
      // verdict text formatting.)
      const competitorsForKey = [...competitors].map((c) => c.trim().toLowerCase()).sort();
      const cacheKey = makeCacheKey(
        'find_public_revenue_signals',
        category.trim().toLowerCase(),
        competitorsForKey.join(','),
      );
      const cached = cacheGet<ToolResult<FindPublicRevenueSignalsData>>(cacheKey);
      if (cached) {
        return { content: [{ type: 'text', text: JSON.stringify(cached, null, 2) }] };
      }

      const sources: ToolSource[] = [];
      const fallbacksUsed: string[] = [];

      const cappedCompetitors = competitors.slice(0, MAX_COMPETITORS_FOR_IH);

      // ─── Parallel fan-out across all four families ──────────────────────
      const [ihSettled, tweetsSettled, secSettled, osSettled] = await Promise.allSettled([
        fetchIndieHackers(competitors, category),
        fetchFounderTweets(competitors, category),
        fetchSecFilings(category),
        fetchOpenStartup(category),
      ]);

      const ih: IndieHackersEntry[] =
        ihSettled.status === 'fulfilled' ? ihSettled.value : [];
      const tweets: FounderMrrTweet[] =
        tweetsSettled.status === 'fulfilled' ? tweetsSettled.value : [];
      const sec: SecFiling[] =
        secSettled.status === 'fulfilled' ? secSettled.value : [];
      const os: OpenStartupEntry[] =
        osSettled.status === 'fulfilled' ? osSettled.value : [];

      // ─── Source attribution — one ToolSource per attempted family ──────
      // IndieHackers: tier A, bias independent (user-submitted but transparent).
      sources.push(
        mkSerperFamilySource(
          'IndieHackers',
          `${cappedCompetitors.map((c) => `"${c}"`).join(' OR ') || category} ${category} revenue OR MRR site:indiehackers.com`,
          'A',
          'independent',
          `${ih.length} IH result(s) for ${cappedCompetitors.length} competitor(s) in "${category}"`,
        ),
      );
      // Founder tweets: tier A, bias conflicted (founder stake — spec §4 rule 6).
      sources.push(
        mkSerperFamilySource(
          'FounderTweets',
          `"${category}" OR "${competitors[0] ?? ''}" "MRR" site:x.com`,
          'A',
          'conflicted',
          `${tweets.length} tweet(s) referencing MRR/recurring revenue in category`,
        ),
      );
      // SEC filings: tier S, bias independent (regulatory).
      sources.push(
        mkSerperFamilySource(
          'SEC',
          `${category} 10-K OR S-1 site:sec.gov`,
          'S',
          'independent',
          `${sec.length} SEC filing reference(s) for category`,
        ),
      );
      // OpenStartup: tier S, bias conflicted (founder-published transparency).
      sources.push(
        mkSerperFamilySource(
          'OpenStartup',
          `${category} open startup MRR transparency`,
          'S',
          'conflicted',
          `${os.length} OpenStartup-style transparency page(s)`,
        ),
      );

      // ─── Fallbacks ─────────────────────────────────────────────────────
      if (!isSerperLive()) {
        fallbacksUsed.push('serper (stub — set SERPER_API_KEY)');
      }
      if (sec.length === 0) {
        fallbacksUsed.push(
          'sec (no filings surfaced — typical for SMB/consumer SaaS; not all categories have public competitors)',
        );
      }
      if (os.length === 0) {
        fallbacksUsed.push(
          'openstartup (no transparency pages surfaced — many founders don\'t publish open-startup numbers)',
        );
      }

      // ─── Summary + scoring ─────────────────────────────────────────────
      const summary = summarize(ih, tweets, sec, os);
      const strength = scoreSignal(ih, tweets, sec, summary);

      // ─── Verdict — framing-aware text, same underlying signals ─────────
      const builderHint = framing?.builder ?? null;
      const lifestyleWeight = builderHint === 'solo';
      const fundedWeight = builderHint === 'funded';

      const ihBlurb =
        ih.length > 0
          ? `${ih.length} IndieHackers entr${ih.length === 1 ? 'y' : 'ies'}${summary.highest_observed_mrr ? ` (highest: ${summary.highest_observed_mrr})` : ''}`
          : 'no IndieHackers entries';
      const tweetBlurb = tweets.length > 0 ? `${tweets.length} founder MRR tweet(s)` : 'no founder MRR tweets';
      const secBlurb = sec.length > 0 ? `${sec.length} SEC filing(s)` : 'no public-company SEC filings';
      const osBlurb = os.length > 0 ? `${os.length} OpenStartup page(s)` : 'no OpenStartup pages';

      let verdict: string;
      switch (strength) {
        case 'strong':
          verdict = `Gate 2 PASS likely + Gate 4 PASS likely. Strong public revenue evidence: ${ihBlurb}; ${secBlurb}. Paid comparables exist at scale — category supports real economics.`;
          break;
        case 'moderate':
          verdict = `Gate 2 CONDITIONAL + Gate 4 CONDITIONAL. Moderate revenue evidence: ${ihBlurb}; ${tweetBlurb}. ${
            lifestyleWeight
              ? 'For a solo builder, IndieHackers comparables are the most relevant — weight these heavier.'
              : fundedWeight
                ? 'For a funded builder, this is light — look for $100M+ ARR comparables before committing.'
                : 'Corroborate with at least one more revenue-evidence source before treating WTP as proven.'
          }`;
          break;
        case 'weak':
          verdict = `Gate 2 WEAK + Gate 4 WEAK. Scattered references with no concrete revenue numbers: ${ihBlurb}; ${tweetBlurb}; ${secBlurb}; ${osBlurb}. Don't treat existence of mentions as evidence of paid demand — narrow the competitor list and re-run, or treat as insufficient.`;
          break;
        default:
          verdict = `Gate 2 FAIL likely + Gate 4 FAIL likely. No public revenue signal: ${ihBlurb}; ${tweetBlurb}; ${secBlurb}; ${osBlurb}. Either category has no public comparables (early/private) or search missed them — pass better competitor names and retry before concluding.`;
      }

      // ─── confidence_note — honest accounting ───────────────────────────
      const unknownCount = requiresUpgradeFromUnknown(sources);
      const conflictedCount = sources.filter(
        (s) => effectiveBias(s.bias) === 'conflicted',
      ).length;
      const independentCount = sources.filter(
        (s) => effectiveBias(s.bias) === 'independent',
      ).length;

      const familiesWithHits =
        (ih.length > 0 ? 1 : 0) +
        (tweets.length > 0 ? 1 : 0) +
        (sec.length > 0 ? 1 : 0) +
        (os.length > 0 ? 1 : 0);

      const confidenceParts: string[] = [];
      confidenceParts.push(
        `Serper: ${isSerperLive() ? 'live' : 'stub (no SERPER_API_KEY)'}; ${familiesWithHits}/4 source families returned results.`,
      );
      confidenceParts.push(
        `IndieHackers: ${ih.length} entr${ih.length === 1 ? 'y' : 'ies'} (capped competitor list at ${cappedCompetitors.length}/${competitors.length}).`,
      );
      confidenceParts.push(
        `Founder tweets: ${tweets.length} result(s) — bias 'conflicted' per spec §4 rule 6 (founder has stake in favorable framing).`,
      );
      confidenceParts.push(
        `SEC: ${sec.length} filing(s) — most SMB/consumer SaaS won't be public; empty here is normal, not a failure.`,
      );
      confidenceParts.push(
        `OpenStartup: ${os.length} page(s) — coverage is thin; many founders publish transparency on personal blogs instead.`,
      );
      confidenceParts.push(
        `MRR extraction is opportunistic regex; raw snippets always preserved (never fabricated).`,
      );
      confidenceParts.push(
        `Source mix: ${independentCount} independent, ${conflictedCount} conflicted${unknownCount > 0 ? `, ${unknownCount} unknown→vendor-funded for math (spec §4 rule 4)` : ''}.`,
      );

      // Phase 09: zero signals across all four families → honest gap.
      // SMB SaaS often has no public revenue data — header comment
      // "Honest empties: SEC filings often return nothing for SMB SaaS"
      // is exactly this case. Models must treat it as evidence gap.
      const envelopeData = {
        indiehackers_entries: ih,
        founder_mrr_tweets: tweets,
        sec_filings: sec,
        openstartup_entries: os,
        revenue_summary: summary,
        gate2_wtp_signal_strength: strength,
        verdict,
      };
      const totalSignals = ih.length + tweets.length + sec.length + os.length;
      const result: ToolResult<FindPublicRevenueSignalsData> =
        totalSignals === 0
          ? honestGapResult(envelopeData, sources, confidenceParts.join(' '), fallbacksUsed)
          : okResult(envelopeData, sources, confidenceParts.join(' '), fallbacksUsed);

      cacheSet(cacheKey, result, TTL.SHORT);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
