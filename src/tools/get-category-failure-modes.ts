import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchReddit } from '../lib/reddit.js';
import { searchHN } from '../lib/hn.js';
import { searchWeb } from '../lib/serper.js';
import type { SignalResult, CategoryFailureMode } from '../types.js';

export function registerGetCategoryFailureModes(server: McpServer) {
  server.registerTool(
    'get_category_failure_modes',
    {
      description:
        'Find the known failure patterns for an entire product category — not just one competitor. Mature products in a category have honest long-term reviews that reveal structural problems any new entrant will face. These are the category-level traps, not bugs.',
      inputSchema: {
        category: z
          .string()
          .describe('Product category to analyze, e.g. "focus app", "habit tracker", "project management tool"'),
        known_products: z
          .array(z.string())
          .optional()
          .describe('Optional list of known products in this category to use as research anchors, e.g. ["Rize", "Opal", "Focus Bear"]'),
      },
    },
    async ({ category, known_products = [] }) => {
      const anchors = known_products.length > 0
        ? known_products.slice(0, 4)
        : [category];

      // Search for long-term honest reviews and complaints across sources
      const searches = await Promise.allSettled([
        searchWeb(
          `${category} problems after 6 months honest review disappointment stopped using`,
          10,
        ),
        searchReddit(
          `${category} gave up stopped using doesn't work after months`,
          undefined,
          'top',
          10,
        ),
        searchHN(`${category} failure problems not worth it`, 'comment', 10),
        // Also search for the known anchor products to find category-wide patterns
        ...anchors.slice(0, 2).map((product) =>
          searchWeb(`${product} review complaints problems`, 5),
        ),
      ]);

      // Collect all text for pattern extraction
      const allText: string[] = [];

      for (const result of searches) {
        if (result.status !== 'fulfilled') continue;
        const r = result.value;

        if ('organic' in r) {
          allText.push(...r.organic.map((o: { title: string; snippet: string }) => `${o.title} ${o.snippet}`));
        } else if ('posts' in r) {
          allText.push(
            ...r.posts.map((p: { title: string; selftext_preview: string }) => `${p.title} ${p.selftext_preview}`),
          );
        } else if ('hits' in r) {
          allText.push(
            ...r.hits.map((h: { title?: string; comment_text?: string; story_text?: string }) =>
              [h.title, h.comment_text, h.story_text].filter(Boolean).join(' '),
            ),
          );
        }
      }

      const combinedText = allText.join('\n').toLowerCase();

      // Category-level failure mode patterns
      const FAILURE_MODE_PATTERNS: { pattern: string; keywords: string[]; is_structural: boolean }[] = [
        {
          pattern: 'Behavior change is hard — the product solves the wrong layer',
          keywords: ['gave up', 'stopped using', 'back to old habits', 'doesn\'t change behavior', 'willpower'],
          is_structural: true,
        },
        {
          pattern: 'High initial friction kills retention before value is delivered',
          keywords: ['setup', 'onboarding', 'complicated', 'too much work to start', 'configuration'],
          is_structural: false,
        },
        {
          pattern: 'Phone escape valve negates desktop-only enforcement',
          keywords: ['phone', 'mobile', 'still distracted', 'just use my phone', 'android', 'ios'],
          is_structural: true,
        },
        {
          pattern: 'Privacy concerns block adoption at scale',
          keywords: ['privacy', 'data', 'screenshot', 'surveillance', 'tracking', 'who has access'],
          is_structural: true,
        },
        {
          pattern: 'Price ceiling too low for sustainable SaaS unit economics',
          keywords: ['too expensive', 'not worth', 'free alternative', 'cancelled', 'price increase'],
          is_structural: true,
        },
        {
          pattern: 'Single modality — users adapt around the restriction',
          keywords: ['worked around', 'bypass', 'disabled', 'turned off', 'uninstalled when'],
          is_structural: true,
        },
        {
          pattern: 'Feature bloat — product tries to be everything',
          keywords: ['bloated', 'too many features', 'overwhelming', 'just want simple', 'simpler'],
          is_structural: false,
        },
        {
          pattern: 'Sync and reliability issues erode trust',
          keywords: ['sync', 'data lost', 'bug', 'crash', 'unreliable', 'broken'],
          is_structural: false,
        },
      ];

      const detectedModes: CategoryFailureMode[] = [];
      const evidence: string[] = [];

      for (const { pattern, keywords, is_structural } of FAILURE_MODE_PATTERNS) {
        const matchingEvidence = allText.filter((text) =>
          keywords.some((kw) => text.toLowerCase().includes(kw)),
        );

        if (matchingEvidence.length > 0) {
          detectedModes.push({
            pattern,
            evidence: matchingEvidence.slice(0, 3).map((e) => e.slice(0, 200)),
            products_affected: anchors,
            is_structural,
          });
          evidence.push(...matchingEvidence.slice(0, 2));
        }
      }

      const structuralCount = detectedModes.filter((m) => m.is_structural).length;

      const isStubbed =
        searches[0].status === 'fulfilled' && 'stubbed' in searches[0].value
          ? (searches[0].value as { stubbed: boolean }).stubbed
          : true;

      const result: SignalResult<{
        category: string;
        failure_modes: CategoryFailureMode[];
        structural_count: number;
        verdict: string;
      }> = {
        signal_type: 'category_failure_modes',
        source: 'serper + reddit + hn',
        query: category,
        timestamp: new Date().toISOString(),
        stubbed: isStubbed,
        data: {
          category,
          failure_modes: detectedModes,
          structural_count: structuralCount,
          verdict:
            structuralCount >= 3
              ? `This category has ${structuralCount} structural failure modes. These are not bugs — they are the shape of the problem. Any new entrant faces the same traps. You need a structural answer to each, not a feature.`
              : structuralCount >= 1
              ? `${structuralCount} structural failure mode(s) detected. Addressable but requires a genuine architectural difference, not just better UX.`
              : 'No obvious structural failure modes detected. Either the category is young or the data needs real API keys for deeper signal.',
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
