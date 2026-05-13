import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SignalResult, YCRFSCategory } from '../types.js';

// YC Summer 2026 RFS — baked in as static data (quarterly cadence).
// Source: the build context document from the advisory session.
// TODO: Scrape https://www.ycombinator.com/rfs on each invocation once Serper is wired up.
const YC_RFS_S26: { name: string; description: string; keywords: string[] }[] = [
  {
    name: 'Company Brain',
    description:
      'Structured, always-current map of how a company works — pulled from Slack, email, tickets, databases — turned into executable skills for AI agents. Not search, not RAG, not a chatbot over docs.',
    keywords: ['company knowledge', 'internal docs', 'slack', 'workflow automation', 'skills', 'agent', 'organizational memory'],
  },
  {
    name: 'Software for Agents',
    description:
      'Every software category rebuilt for agents as first-class citizens. APIs, MCPs, CLIs instead of visual interfaces. Machine-readable docs. Programmatic discovery and signup.',
    keywords: ['mcp', 'api', 'cli', 'agent', 'programmatic', 'machine readable', 'developer tool', 'sdk'],
  },
  {
    name: 'AI-Native Service Companies',
    description:
      'Sell the service, not the software. Replace outsourced functions end-to-end — accounting, compliance, insurance brokerage, healthcare admin.',
    keywords: ['service', 'outsourcing', 'accounting', 'compliance', 'legal', 'healthcare', 'brokerage', 'end-to-end'],
  },
  {
    name: 'Dynamic Software Interfaces',
    description:
      'Users as their own forward-deployed engineers. Shared primitives, radically customized interfaces per user.',
    keywords: ['customizable', 'personalized', 'adaptive ui', 'no-code', 'user-defined', 'dynamic interface'],
  },
  {
    name: 'SaaS Challengers',
    description:
      'AI collapsed software dev costs 10-100x. Attack categories that seemed untouchable: ERPs, chip design tools, industrial control, supply chain.',
    keywords: ['erp', 'enterprise', 'legacy software', 'vertical saas', 'industrial', 'supply chain', 'manufacturing'],
  },
  {
    name: 'AI Operating System for Companies',
    description:
      'Connective layer making the entire company legible to AI — Slack + Linear + GitHub + Notion + call recordings into a single intelligence layer that reasons across all of it.',
    keywords: ['integration', 'connective layer', 'data platform', 'intelligence', 'cross-tool', 'unified', 'reasoning'],
  },
];

function scoreAlignment(
  idea: string,
  category: { name: string; description: string; keywords: string[] },
): { score: number; matching_keywords: string[] } {
  const lowerIdea = idea.toLowerCase();
  const matching = category.keywords.filter((kw) => lowerIdea.includes(kw.toLowerCase()));

  // Base score from keyword overlap (0-7 points)
  let score = matching.length;

  // Bonus if idea description overlaps with category description words
  const descWords = category.description.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
  const descMatches = descWords.filter((w) => lowerIdea.includes(w)).length;
  score += Math.min(3, descMatches);

  return { score: Math.min(10, score), matching_keywords: matching };
}

export function registerFindYCRFSAlignment(server: McpServer) {
  server.registerTool(
    'find_yc_rfs_alignment',
    {
      description:
        'Map your idea to YC\'s current Request for Startups categories. Use as a signal for where investor and market attention is focused — not as validation on its own. Strong alignment = tailwind. No alignment = you\'re swimming upstream or ahead of the curve.',
      inputSchema: {
        idea_description: z
          .string()
          .describe('Plain-language description of the product idea and what problem it solves'),
      },
    },
    async ({ idea_description }) => {
      const scored: YCRFSCategory[] = YC_RFS_S26.map((cat) => {
        const { score, matching_keywords } = scoreAlignment(idea_description, cat);
        const fit: YCRFSCategory['fit'] =
          score >= 6 ? 'strong' : score >= 3 ? 'moderate' : score >= 1 ? 'weak' : 'none';

        return {
          name: cat.name,
          description: cat.description,
          alignment_score: score,
          alignment_reasoning:
            matching_keywords.length > 0
              ? `Matched keywords: ${matching_keywords.join(', ')}`
              : 'No keyword overlap detected',
          fit,
        };
      }).sort((a, b) => b.alignment_score - a.alignment_score);

      const topFit = scored[0];
      const strongFits = scored.filter((c) => c.fit === 'strong');

      const result: SignalResult<{
        categories: YCRFSCategory[];
        top_match: YCRFSCategory;
        verdict: string;
        rfs_vintage: string;
      }> = {
        signal_type: 'yc_rfs_alignment',
        source: 'YC RFS S26 (static — baked in)',
        query: idea_description,
        timestamp: new Date().toISOString(),
        stubbed: false, // static data, always available
        data: {
          categories: scored,
          top_match: topFit,
          verdict:
            strongFits.length > 0
              ? `Strong YC RFS alignment with: ${strongFits.map((c) => c.name).join(', ')}. This is a tailwind — investors and the ecosystem are actively looking for this. Doesn't validate the idea, but removes headwind.`
              : topFit.alignment_score > 0
              ? `Weak-to-moderate alignment with ${topFit.name}. Not a primary focus area for YC S26 — either early, consumer-facing, or in a category they haven't flagged.`
              : 'No alignment with current YC RFS. Either consumer product, too niche, or genuinely contrarian. Not disqualifying — assess on fundamentals.',
          rfs_vintage: 'YC Summer 2026',
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
