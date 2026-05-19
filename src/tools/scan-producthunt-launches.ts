import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult } from '../types.js';
import { searchProductHunt, phSource, phConfidenceNote, isPHLive } from '../lib/producthunt.js';

type LaunchSignal = 'high_conviction' | 'viral_but_shallow' | 'low_signal';

interface PHLaunch {
  name: string;
  tagline: string;
  url: string;
  votes: number;
  comments: number;
  launched_at: string;
  topics: string[];
  top_comment?: string;
  engagement_ratio: number;
  signal: LaunchSignal;
}

interface ScanProductHuntLaunchesData {
  launches: PHLaunch[];
}

function computeSignal(votes: number, comments: number): { ratio: number; signal: LaunchSignal } {
  const ratio = votes > 0 ? (comments / votes) * 100 : 0;
  let signal: LaunchSignal;
  if (ratio >= 15) {
    signal = 'high_conviction';
  } else if (votes >= 500 && ratio < 5) {
    signal = 'viral_but_shallow';
  } else {
    signal = 'low_signal';
  }
  return { ratio: Math.round(ratio * 10) / 10, signal };
}

export function registerScanProductHuntLaunches(server: McpServer): void {
  server.registerTool(
    'scan_producthunt_launches',
    {
      description:
        'Search Product Hunt for launches in a category. Computes engagement ratio (comments/votes) to distinguish high-conviction launches from viral-but-shallow ones.',
      inputSchema: {
        category: z.string().describe('Category or topic to search for on Product Hunt'),
        date_range: z
          .object({
            from: z.string().describe('ISO date string start of range (e.g., "2024-01-01")'),
            to: z.string().optional().describe('ISO date string end of range (optional, defaults to now)'),
          })
          .optional()
          .describe('Optional date range to filter launches'),
      },
    },
    async ({ category }) => {
      const fallbacksUsed: string[] = [];
      if (!isPHLive()) fallbacksUsed.push('producthunt (stub — set PRODUCTHUNT_API_KEY)');

      const posts = await searchProductHunt(category, 15);

      const launches: PHLaunch[] = posts.map((post) => {
        const { ratio, signal } = computeSignal(post.votesCount, post.commentsCount);
        return {
          name: post.name,
          tagline: post.tagline,
          url: post.url,
          votes: post.votesCount,
          comments: post.commentsCount,
          launched_at: post.createdAt,
          topics: post.topics?.map((t) => t.name) ?? [],
          top_comment: post.topComment,
          engagement_ratio: ratio,
          signal,
        };
      });

      // Sort by engagement ratio desc
      launches.sort((a, b) => b.engagement_ratio - a.engagement_ratio);

      const highConviction = launches.filter((l) => l.signal === 'high_conviction').length;
      const viralShallow = launches.filter((l) => l.signal === 'viral_but_shallow').length;

      const result: ToolResult<ScanProductHuntLaunchesData> = {
        data: { launches },
        sources: [phSource(category)],
        confidence_note: [
          phConfidenceNote(),
          highConviction > 0
            ? `${highConviction} high-conviction launch(es) found (engagement ratio >15%).`
            : 'No high-conviction launches found.',
          viralShallow > 0
            ? `${viralShallow} viral-but-shallow launch(es) (high votes, low comment ratio — curiosity, not deep need).`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
        fallbacks_used: fallbacksUsed,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
