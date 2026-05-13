import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchWeb } from '../lib/serper.js';
import { searchHN } from '../lib/hn.js';
import { searchProductHunt } from '../lib/producthunt.js';
import type { SignalResult, Competitor } from '../types.js';

export function registerFindClosestCompetitor(server: McpServer) {
  server.registerTool(
    'find_closest_competitor',
    {
      description:
        'Find the closest existing product to your idea. Returns competitor name, funding status, launch date, and where they live. Read their changelog next.',
      inputSchema: {
        idea_description: z
          .string()
          .describe('Plain-language description of your product idea and the problem it solves'),
        search_angle: z
          .string()
          .optional()
          .describe(
            'Optional: the specific mechanic to search for. E.g. "AI screen monitoring ADHD on-task 2025" instead of just "focus app"',
          ),
      },
    },
    async ({ idea_description, search_angle }) => {
      const query = search_angle ?? idea_description;

      const [webResults, hnResults, phResults] = await Promise.allSettled([
        searchWeb(`${query} product launch site:producthunt.com OR site:techcrunch.com OR site:betalist.com`, 8),
        searchHN(query, 'story', 5),
        searchProductHunt(query),
      ]);

      const competitors: Competitor[] = [];

      // Extract from web results
      if (webResults.status === 'fulfilled') {
        for (const r of webResults.value.organic.slice(0, 3)) {
          competitors.push({
            name: r.title.replace(/\s*[-|].*$/, '').trim(),
            url: r.link,
            description: r.snippet,
            launch_date: r.date,
          });
        }
      }

      // Surface top PH launch as primary competitor if found
      if (phResults.status === 'fulfilled' && phResults.value.products.length > 0) {
        const top = phResults.value.products[0];
        competitors.unshift({
          name: top.name,
          url: top.url,
          description: top.tagline,
          launch_date: top.launched_at,
        });
      }

      const result: SignalResult<{
        competitors: Competitor[];
        hn_mentions: number;
        ph_launches: number;
        recommendation: string;
      }> = {
        signal_type: 'competitive_landscape',
        source: 'serper + producthunt + hn',
        query,
        timestamp: new Date().toISOString(),
        stubbed:
          webResults.status === 'fulfilled'
            ? webResults.value.stubbed
            : true,
        data: {
          competitors: competitors.slice(0, 5),
          hn_mentions:
            hnResults.status === 'fulfilled' ? hnResults.value.nbHits : 0,
          ph_launches:
            phResults.status === 'fulfilled'
              ? phResults.value.products.length
              : 0,
          recommendation:
            competitors.length > 0
              ? `Found ${competitors.length} potential competitors. Run read_competitor_changelog on the closest match next.`
              : 'No obvious direct competitors found — check search_angle parameter or broaden the description.',
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
