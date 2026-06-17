import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult } from '../types.js';
import { okResult, honestGapResult } from '../lib/envelope.js';
import { serperSearch, serperSource, serperConfidenceNote, isSerperLive } from '../lib/serper.js';
import { searchReddit, redditSource, redditConfidenceNote, isRedditLive } from '../lib/reddit.js';
import { searchHN, hnSource } from '../lib/hn.js';
import { competitorAppears, isRelevant, buildRelevanceTerms } from '../lib/relevance.js';

interface WeaknessSignal {
  source: 'serper' | 'reddit' | 'hn';
  quote: string;
  url?: string;
  upvotes?: number;
  is_structural: boolean;
}

// Phase 11 — a complaint snippet is on-topic only if the competitor appears as
// a real entity AND (when a category is known) the text is category-relevant
// or carries a software-product cue. Drops same-name noise like "Opal apples"
// / "opal jewelry" that the ambiguous single-word query pulls in.
const PRODUCT_CUE =
  /\b(app|apps|software|subscription|pricing|plan|feature|account|login|sign[- ]?up|update|version|ui|interface|customer|support|refund|cancel(led)?|billing|users?|sync|integration|api|bug|crash|paywall|download|install)\b/i;

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

interface WeaknessTheme {
  theme: string;
  count: number;
  /** Phase 11 — distinct source hosts/channels backing this theme. */
  distinct_sources: number;
  is_structural: boolean;
}

interface MapCompetitiveWeaknessesData {
  signals: WeaknessSignal[];
  weakness_themes: WeaknessTheme[];
  structural_weaknesses: string[];
  feature_gaps: string[];
  interpretation: string;
}

const STRUCTURAL_KEYWORDS = [
  'always', 'never', 'constantly', 'every time', 'years', 'since launch',
  'fundamental', 'by design', 'core issue', 'architecture', 'not possible',
  'can\'t', 'won\'t fix', 'known limitation',
];

function isStructural(text: string): boolean {
  return STRUCTURAL_KEYWORDS.some((kw) => text.toLowerCase().includes(kw));
}

function extractThemes(signals: WeaknessSignal[]): WeaknessTheme[] {
  const themeKeywords: Record<string, RegExp[]> = {
    'Pricing / Value': [/expens|pric|cost|cheap|value|worth/i],
    'Performance / Speed': [/slow|lag|timeout|crash|performance|latency/i],
    'Complexity / UX': [/confus|complex|hard to use|steep.?learning|onboard/i],
    'Missing Features': [/missing|wish|need|want|lack|no support for/i],
    'Support / Docs': [/support|documentation|docs|response.?time|help/i],
    'Integration Gaps': [/integrat|connect|api|sync|import|export/i],
    'Reliability / Bugs': [/bug|broken|unreliable|error|fail|glitch/i],
    'Vendor Lock-in': [/lock.?in|export|migrate|portab/i],
  };

  const themeCounts: Record<string, { count: number; structural: boolean; hosts: Set<string> }> = {};

  for (const signal of signals) {
    const text = signal.quote;
    // Distinct-source key: URL host if available, else the channel name.
    const sourceKey = hostOf(signal.url) ?? signal.source;
    for (const [theme, patterns] of Object.entries(themeKeywords)) {
      if (patterns.some((p) => p.test(text))) {
        if (!themeCounts[theme]) themeCounts[theme] = { count: 0, structural: false, hosts: new Set() };
        themeCounts[theme].count++;
        themeCounts[theme].hosts.add(sourceKey);
        if (signal.is_structural) themeCounts[theme].structural = true;
      }
    }
  }

  return Object.entries(themeCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([theme, { count, structural, hosts }]) => ({
      theme,
      count,
      distinct_sources: hosts.size,
      is_structural: structural,
    }));
}

export function registerMapCompetitiveWeaknesses(server: McpServer): void {
  server.registerTool(
    'map_competitive_weaknesses',
    {
      description:
        "Surface user-reported weaknesses of a competitor by searching Reddit, HN, and the web. Identifies structural vs. surface-level weaknesses and common complaint themes. Envelope: { status: 'ok'|'honest_gap'|'error', data, sources, confidence_note, fallbacks_used, error? }. status='honest_gap' = ran cleanly, no substantive data found (evidence gap, not failure).",
      inputSchema: {
        competitor_name: z.string().describe('Name of the competitor to analyze'),
        category: z
          .string()
          .optional()
          .describe('Optional category context (e.g., "project management", "analytics")'),
      },
    },
    async ({ competitor_name, category }) => {
      const fallbacksUsed: string[] = [];
      const signals: WeaknessSignal[] = [];
      let droppedOffTopic = 0;

      const baseQuery = category
        ? `${competitor_name} ${category} problems complaints review`
        : `${competitor_name} problems complaints review`;

      const negativeQuery = `${competitor_name} "not worth" OR "cancelled" OR "switched from" OR "disappointed" OR "terrible"`;

      // Phase 11 — relevance gate. The single-word competitor query pulls in
      // same-name noise ("Opal apples", "opal jewelry"); only keep a snippet
      // if the competitor appears as a real entity AND (when a category is
      // known) it's category-relevant or carries a software-product cue.
      const categoryTerms = category ? buildRelevanceTerms(category, []) : [];
      const onTopic = (text: string): boolean => {
        if (!competitorAppears(text, competitor_name)) return false;
        if (!category) return true;
        return isRelevant(text, categoryTerms, category) || PRODUCT_CUE.test(text);
      };
      const pushSignal = (s: WeaknessSignal): void => {
        if (onTopic(s.quote)) signals.push(s);
        else droppedOffTopic++;
      };

      // Serper
      const serperResults = await serperSearch(negativeQuery, 8);
      if (!isSerperLive()) fallbacksUsed.push('serper (stub — set SERPER_API_KEY)');
      for (const r of serperResults) {
        pushSignal({ source: 'serper', quote: r.snippet, url: r.link, is_structural: isStructural(r.snippet) });
      }

      // Reddit
      const redditResult = await searchReddit(`${competitor_name} problems OR complaints OR "switched from"`, 10);
      if (!isRedditLive()) fallbacksUsed.push('reddit (stub — set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET)');
      for (const post of redditResult.posts) {
        const text = `${post.title} ${post.selftext}`.slice(0, 500);
        pushSignal({ source: 'reddit', quote: text, url: `https://reddit.com${post.permalink}`, upvotes: post.score, is_structural: isStructural(text) });
      }

      // HN
      const hnHits = await searchHN(`${competitor_name} problems OR limitations`, 10);
      for (const hit of hnHits) {
        const text = (hit.title ?? '') + ' ' + (hit.story_text ?? '');
        if (text.trim().length < 20) continue;
        pushSignal({ source: 'hn', quote: text.slice(0, 300), url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`, upvotes: hit.points, is_structural: isStructural(text) });
      }

      const themes = extractThemes(signals);
      // Phase 11 — "structural" requires the theme to recur across >=3 DISTINCT
      // sources (distinct URL hosts, falling back to channel), not 3 snippets
      // from one query. This is what the interpretation text claims.
      const structuralThemes = themes.filter((t) => t.is_structural && t.distinct_sources >= 3);
      const structural_weaknesses = structuralThemes.map((t) => t.theme);

      const featureGapPatterns = [/missing|need|wish|want|should have|no (support for|ability to)/i];
      const feature_gaps = signals
        .filter((s) => featureGapPatterns.some((p) => p.test(s.quote)))
        .slice(0, 5)
        .map((s) => s.quote.slice(0, 150));

      let interpretation: string;
      if (signals.length === 0) {
        interpretation = `No weakness signals found for ${competitor_name}. This could mean: (1) strong product with satisfied users, (2) insufficient public discussion, or (3) search stubs are masking real data. Enable live APIs for better signal.`;
      } else if (structural_weaknesses.length > 0) {
        const ds = structuralThemes.map((t) => `${t.theme} (${t.distinct_sources} distinct sources)`).join(', ');
        interpretation = `Found ${structural_weaknesses.length} structural weakness(es): ${ds}. Each recurs across 3+ distinct sources (not just snippets) and is unlikely to be fixed quickly — a defensible basis for differentiation.`;
      } else {
        interpretation = `Found ${signals.length} on-topic weakness signal(s) but none recur across 3+ distinct sources. Themes: ${themes.slice(0, 3).map((t) => t.theme).join(', ') || 'none'}. Surface-level — competitor could fix these; don't build a moat on them.`;
      }

      // Phase 09: no signals + no themes → honest gap (searches ran, no
      // complaints surfaced). Model logs and continues; does NOT retry,
      // does NOT invent infra error.
      const envelopeData = {
        signals: signals.slice(0, 20),
        weakness_themes: themes,
        structural_weaknesses,
        feature_gaps,
        interpretation,
      };
      const envelopeSources = [
        serperSource(negativeQuery),
        redditSource(competitor_name),
        hnSource(baseQuery),
      ];
      const envelopeNote = [
        serperConfidenceNote(),
        redditConfidenceNote(),
        'HN data is live.',
        droppedOffTopic > 0
          ? `Excluded ${droppedOffTopic} off-topic hit(s) that mentioned "${competitor_name}" without category/product relevance (same-name disambiguation).`
          : '',
      ]
        .filter(Boolean)
        .join(' ');
      const result: ToolResult<MapCompetitiveWeaknessesData> =
        signals.length === 0 && themes.length === 0
          ? honestGapResult(envelopeData, envelopeSources, envelopeNote, fallbacksUsed)
          : okResult(envelopeData, envelopeSources, envelopeNote, fallbacksUsed);

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
