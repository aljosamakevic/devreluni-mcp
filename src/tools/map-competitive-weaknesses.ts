import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchWeb } from '../lib/serper.js';
import { searchReddit } from '../lib/reddit.js';
import { searchHN } from '../lib/hn.js';
import type { SignalResult, WeaknessSignal } from '../types.js';

// When 3+ independent sources flag the same issue, it's structural — not anecdotal.
const STRUCTURAL_THRESHOLD = 3;

function countMentions(signals: WeaknessSignal[], keyword: string): number {
  return signals.filter((s) =>
    s.quote.toLowerCase().includes(keyword.toLowerCase()),
  ).length;
}

export function registerMapCompetitiveWeaknesses(server: McpServer) {
  server.registerTool(
    'map_competitive_weaknesses',
    {
      description:
        'Synthesize press coverage, Reddit complaints, and HN threads into a structured weakness map. When 3+ independent sources flag the same issue, it\'s structural — not an edge case. Use this to find exploitable gaps, then ask: is this a feature (incumbent can ship it) or a structure (would require rebuilding the product)?',
      inputSchema: {
        competitor_name: z
          .string()
          .describe('Name of the competitor product to analyze, e.g. "Fomi" or "Notion"'),
        category: z
          .string()
          .optional()
          .describe('Product category for broader context, e.g. "focus app" or "project management"'),
      },
    },
    async ({ competitor_name, category }) => {
      const searchQuery = category
        ? `${competitor_name} ${category} problems complaints review`
        : `${competitor_name} problems complaints review`;

      const [webResults, redditResults, hnResults] = await Promise.allSettled([
        searchWeb(`${competitor_name} review criticism problems "doesn't work" OR "wish it had" OR "biggest issue"`, 10),
        searchReddit(`${competitor_name}`, undefined, 'top', 10),
        searchHN(`${competitor_name}`, 'comment', 10),
      ]);

      const signals: WeaknessSignal[] = [];

      if (webResults.status === 'fulfilled') {
        for (const r of webResults.value.organic) {
          signals.push({
            source: 'press',
            quote: r.snippet,
            url: r.link,
            is_structural: false, // assessed below
          });
        }
      }

      if (redditResults.status === 'fulfilled') {
        for (const post of redditResults.value.posts) {
          signals.push({
            source: 'reddit',
            quote: `${post.title} — ${post.selftext_preview}`,
            url: post.permalink,
            upvotes: post.score,
            is_structural: false,
          });
        }
      }

      if (hnResults.status === 'fulfilled') {
        for (const hit of hnResults.value.hits) {
          const text = hit.comment_text ?? hit.story_text ?? hit.title ?? '';
          if (!text) continue;
          signals.push({
            source: 'hn',
            quote: text.slice(0, 300),
            url: hit.url,
            upvotes: hit.points,
            is_structural: false,
          });
        }
      }

      // Common weakness themes to check across all sources
      const weaknessThemes = [
        'privacy', 'price', 'expensive', 'mobile', 'slow', 'setup',
        'complicated', 'battery', 'sync', 'offline', 'crash', 'support',
        'screenshot', 'surveillance', 'tracking', 'cancel', 'refund',
      ];

      const structuralWeaknesses: { theme: string; count: number; is_structural: boolean }[] = [];

      for (const theme of weaknessThemes) {
        const count = countMentions(signals, theme);
        if (count > 0) {
          structuralWeaknesses.push({
            theme,
            count,
            is_structural: count >= STRUCTURAL_THRESHOLD,
          });
        }
      }

      // Mark individual signals as structural if their content matches a structural theme
      const structuralThemes = structuralWeaknesses
        .filter((w) => w.is_structural)
        .map((w) => w.theme);

      for (const signal of signals) {
        signal.is_structural = structuralThemes.some((t) =>
          signal.quote.toLowerCase().includes(t),
        );
      }

      structuralWeaknesses.sort((a, b) => b.count - a.count);

      const isStubbed =
        (webResults.status === 'fulfilled' && webResults.value.stubbed) ||
        (redditResults.status === 'fulfilled' && redditResults.value.stubbed);

      const result: SignalResult<{
        signals: WeaknessSignal[];
        weakness_themes: typeof structuralWeaknesses;
        structural_weaknesses: string[];
        feature_gaps: string[];
        interpretation: string;
      }> = {
        signal_type: 'competitive_weaknesses',
        source: 'serper + reddit + hn',
        query: searchQuery,
        timestamp: new Date().toISOString(),
        stubbed: isStubbed,
        data: {
          signals: signals.slice(0, 15),
          weakness_themes: structuralWeaknesses,
          structural_weaknesses: structuralWeaknesses
            .filter((w) => w.is_structural)
            .map((w) => w.theme),
          feature_gaps: structuralWeaknesses
            .filter((w) => !w.is_structural && w.count > 0)
            .map((w) => w.theme),
          interpretation:
            structuralWeaknesses.filter((w) => w.is_structural).length > 0
              ? `Structural weaknesses (3+ independent sources): ${structuralWeaknesses.filter((w) => w.is_structural).map((w) => `${w.theme} (${w.count})`).join(', ')}. These require rebuilding the product to fix — an incumbent cannot ship a patch. For each: ask if fixing it creates asymmetric distribution or just a better product.`
              : 'No structural weaknesses detected above threshold. Either the product is solid or the data sources need real API keys for deeper signal.',
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
