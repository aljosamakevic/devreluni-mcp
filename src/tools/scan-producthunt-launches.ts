import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult } from '../types.js';
import {
  searchProductHunt,
  searchPostsByTopic,
  resolveTopicSlug,
  phSource,
  phConfidenceNote,
  isPHLive,
} from '../lib/producthunt.js';

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

      // M6 fix: prefer topic-resolved posts over query-by-string search.
      // Free-form categories like "focus app" return sparse / wrong results
      // via the search field; resolving to a canonical PH topic slug first
      // yields ranked posts within the right vertical.
      let posts;
      let sourceContribution: string;
      let fetchPathNote: string | null = null;
      const slug = await resolveTopicSlug(category);

      if (slug) {
        posts = await searchPostsByTopic(slug, 15);
        sourceContribution = `PH posts by topic '${slug}' (resolved from '${category}')`;
        if (posts.length === 0) {
          fetchPathNote = `PH topic '${slug}' returned 0 posts.`;
        }
      } else {
        // Fallback per D-T07-1: topics API unavailable or no match. Use the
        // legacy query-by-string path and surface the gap honestly per spec
        // §11 anti-pattern 2 (no silent failures).
        posts = await searchProductHunt(category, 15);
        sourceContribution = `PH query-by-string search for '${category}' (topic resolution returned no match)`;
        fetchPathNote = isPHLive()
          ? `PH topic resolution returned 0 matches for '${category}' — using query-based search; results may be off-topic.`
          : `PH topics API unavailable — falling back to query-based search.`;
      }

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

      const baseSource = phSource(category);
      const sources = [{ ...baseSource, contribution: sourceContribution }];

      const result: ToolResult<ScanProductHuntLaunchesData> = {
        data: { launches },
        sources,
        confidence_note: [
          phConfidenceNote(),
          fetchPathNote ?? '',
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
