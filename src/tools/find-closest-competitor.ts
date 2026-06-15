import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult } from '../types.js';
import { okResult } from '../lib/envelope.js';
import { serperSearch, serperSource, serperConfidenceNote, isSerperLive } from '../lib/serper.js';
import { searchProductHunt, phSource, phConfidenceNote, isPHLive } from '../lib/producthunt.js';
import { searchHN, hnSource } from '../lib/hn.js';
import { requiresUpgradeFromUnknown } from '../lib/bias.js';

interface Competitor {
  name: string;
  url: string;
  description: string;
  launch_date?: string;
  funding?: string;
}

interface FindClosestCompetitorData {
  competitors: Competitor[];
  hn_mentions: number;
  ph_launches: number;
  recommendation: string;
}

export function registerFindClosestCompetitor(server: McpServer): void {
  server.registerTool(
    'find_closest_competitor',
    {
      description:
        'Find the closest competitors to a product idea using web search, Product Hunt, and Hacker News. Returns a list of competitors with tier/bias-annotated sources.',
      inputSchema: {
        idea_description: z.string().describe('Description of the product idea to find competitors for'),
        search_angle: z
          .string()
          .optional()
          .describe('Optional specific angle to search (e.g., "enterprise", "mobile-first", "open-source")'),
      },
    },
    async ({ idea_description, search_angle }) => {
      const query = search_angle
        ? `${idea_description} ${search_angle} competitor alternatives`
        : `${idea_description} alternatives competitors`;

      const fallbacksUsed: string[] = [];

      // Serper search
      const serperResults = await serperSearch(query, 8);
      if (!isSerperLive()) fallbacksUsed.push('serper (stub — set SERPER_API_KEY)');

      // Product Hunt search
      const phResults = await searchProductHunt(idea_description, 5);
      if (!isPHLive()) fallbacksUsed.push('producthunt (stub — set PRODUCTHUNT_API_KEY)');

      // HN search
      const hnHits = await searchHN(query, 10);

      // Build competitor list from serper results
      const competitors: Competitor[] = serperResults.slice(0, 5).map((r) => ({
        name: r.title.replace(/[[\]]/g, '').split(' - ')[0].trim(),
        url: r.link,
        description: r.snippet,
      }));

      // Merge PH results
      for (const ph of phResults.slice(0, 3)) {
        const alreadyFound = competitors.some(
          (c) => c.url === ph.url || c.name.toLowerCase().includes(ph.name.toLowerCase())
        );
        if (!alreadyFound) {
          competitors.push({
            name: ph.name,
            url: ph.url,
            description: ph.tagline,
            launch_date: ph.createdAt,
          });
        }
      }

      const hn_mentions = hnHits.length;
      const ph_launches = phResults.length;

      let recommendation: string;
      if (competitors.length === 0) {
        recommendation =
          'No competitors found. This may indicate a nascent market (opportunity) or an unsearched niche (validate demand before building).';
      } else if (competitors.length >= 5) {
        recommendation =
          `Found ${competitors.length} competitors — crowded space. Focus on structural weaknesses via map_competitive_weaknesses before proceeding.`;
      } else {
        recommendation =
          `Found ${competitors.length} competitor(s). Run read_competitor_changelog on the top result and map_competitive_weaknesses to identify exploitable gaps.`;
      }

      const confidenceParts: string[] = [];
      confidenceParts.push(serperConfidenceNote());
      confidenceParts.push(phConfidenceNote());
      confidenceParts.push('HN data is live (no API key required).');

      const builtSources = [
        serperSource(query),
        phSource(idea_description),
        hnSource(query),
      ];
      // Spec §4 rule 4 + §11 anti-pattern 6: disclose any `unknown` bias
      // sources in the confidence note. They are treated as vendor-funded
      // for downstream math by effectiveBias(), but the conversion must
      // be visible so the consumer (LLM / user) can audit it.
      const unknownCount = requiresUpgradeFromUnknown(builtSources);
      if (unknownCount > 0) {
        confidenceParts.push(
          `${unknownCount}/${builtSources.length} sources had unknown bias — treated as vendor-funded for confidence math (spec §4 rule 4).`
        );
      }

      const result: ToolResult<FindClosestCompetitorData> = okResult(
        { competitors, hn_mentions, ph_launches, recommendation },
        builtSources,
        confidenceParts.join(' '),
        fallbacksUsed,
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
