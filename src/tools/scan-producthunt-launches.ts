import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchProductHunt } from '../lib/producthunt.js';
import type { SignalResult, ProductHuntLaunch } from '../types.js';

export function registerScanProductHuntLaunches(server: McpServer) {
  server.registerTool(
    'scan_producthunt_launches',
    {
      description:
        'Scan recent Product Hunt launches in a category to map the competitive landscape and see what the market has already tried. High votes with low comments = people upvoted but didn\'t engage. High comments = actual interest or controversy.',
      inputSchema: {
        category: z
          .string()
          .describe('Product category or topic to search, e.g. "focus app" or "AI writing assistant"'),
        date_range: z
          .object({
            from: z.string().describe('ISO date string, e.g. "2024-01-01"'),
            to: z.string().optional().describe('ISO date string, defaults to today'),
          })
          .optional()
          .describe('Optional date range to filter launches'),
      },
    },
    async ({ category, date_range }) => {
      const phResult = await searchProductHunt(category, date_range);

      const launches: ProductHuntLaunch[] = phResult.products.map((p) => ({
        name: p.name,
        tagline: p.tagline,
        url: p.url,
        votes: p.votes,
        comments: p.comments,
        launched_at: p.launched_at,
        topics: p.topics,
        top_comment: p.top_comment,
      }));

      // Engagement ratio — high votes / low comments signals passive interest, not conviction
      const withEngagement = launches.map((l) => ({
        ...l,
        engagement_ratio:
          l.votes > 0 ? Math.round((l.comments / l.votes) * 100) : 0,
        signal:
          l.comments / l.votes > 0.15
            ? 'high_conviction' // people actually talked about it
            : l.votes > 500
            ? 'viral_but_shallow' // upvoted, not adopted
            : 'low_signal',
      }));

      const topByVotes = [...withEngagement].sort((a, b) => b.votes - a.votes);
      const topByEngagement = [...withEngagement].sort(
        (a, b) => b.engagement_ratio - a.engagement_ratio,
      );

      const result: SignalResult<{
        launches: typeof withEngagement;
        top_by_votes: (typeof withEngagement)[0][];
        top_by_engagement: (typeof withEngagement)[0][];
        market_signal: string;
      }> = {
        signal_type: 'producthunt_launches',
        source: 'producthunt',
        query: category,
        timestamp: new Date().toISOString(),
        stubbed: phResult.stubbed,
        data: {
          launches: withEngagement,
          top_by_votes: topByVotes.slice(0, 3),
          top_by_engagement: topByEngagement.slice(0, 3),
          market_signal:
            launches.length === 0
              ? 'No launches found — either a gap in the market or a gap in the search terms.'
              : launches.length > 5
              ? `${launches.length} launches found in this category. Competitive space. Check if top launches have high engagement (conviction) or just votes (hype).`
              : `${launches.length} launches found. Early or niche market. Run find_closest_competitor for deeper competitive analysis.`,
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
