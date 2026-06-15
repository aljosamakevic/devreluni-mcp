import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult, ToolSource } from '../types.js';
import { okResult } from '../lib/envelope.js';

const RFS_VINTAGE = 'YC Summer 2026';
const RFS_SOURCE_URL = 'https://www.ycombinator.com/rfs';

type Fit = 'strong' | 'moderate' | 'weak' | 'none';

interface RFSCategory {
  name: string;
  description: string;
  alignment_score: number; // 0-100
  alignment_reasoning: string;
  fit: Fit;
}

interface FindYCRFSAlignmentData {
  categories: RFSCategory[];
  top_match: string;
  verdict: string;
  rfs_vintage: string;
}

const YC_S26_CATEGORIES = [
  {
    name: 'Company Brain',
    description:
      'Software that acts as an intelligent operating system for companies — capturing institutional knowledge, automating cross-functional workflows, and enabling AI to make or recommend decisions across the business. Think Notion + Slack + internal tooling, but AI-native.',
    keywords: [
      /company (brain|memory|os|operating system)/i,
      /institutional knowledge/i,
      /cross.?functional/i,
      /internal (tool|workflow|automation)/i,
      /enterprise (ai|automation|intelligence)/i,
    ],
  },
  {
    name: 'Software for Agents',
    description:
      'Infrastructure, tooling, and platforms that enable AI agents to operate reliably in the real world — orchestration, memory, tool use, evaluation, sandboxing, and deployment primitives for autonomous AI systems.',
    keywords: [
      /agent (platform|infra|infrastructure|orchestrat|tool|memory|deploy)/i,
      /autonomous (ai|agent|system)/i,
      /llm (tool|orchestrat|agent)/i,
      /agentic/i,
      /multi.?agent/i,
    ],
  },
  {
    name: 'AI-Native Service Companies',
    description:
      'Companies delivering services traditionally performed by humans — legal, accounting, HR, consulting, design, coding — using AI to deliver at 10-100x lower cost with equivalent or better quality. Not software with AI features; fundamentally an AI-delivered service.',
    keywords: [
      /ai.?native service/i,
      /ai (law|legal|accounting|hr|consult|design|audit|tax)/i,
      /replace (human|worker|team)/i,
      /10x cheaper|100x cheaper/i,
      /fractional (cfo|cto|coo|legal|hr)/i,
    ],
  },
  {
    name: 'Dynamic Software Interfaces',
    description:
      'Software where the UI itself is generated or adapted by AI — interfaces that change based on user context, role, and task rather than being statically designed. Post-SaaS UI paradigm.',
    keywords: [
      /dynamic (ui|interface|frontend)/i,
      /ai.?generated (ui|interface|layout)/i,
      /adaptive (ui|interface)/i,
      /no.?code.*ai|ai.*no.?code/i,
      /context.?aware interface/i,
    ],
  },
  {
    name: 'SaaS Challengers',
    description:
      'New entrants challenging established SaaS incumbents by rebuilding category-defining products as AI-native. Not just adding AI features to existing workflows — rethinking what the product fundamentally does when AI is the primary interface.',
    keywords: [
      /saas (challenger|replacement|alternative|rebuild)/i,
      /replace (salesforce|hubspot|zendesk|jira|notion|slack|asana)/i,
      /ai.?native (crm|erp|hris|ats|project management|helpdesk)/i,
      /vertical saas/i,
    ],
  },
  {
    name: 'AI Operating System for Companies',
    description:
      'A unifying layer that integrates all company data, tools, and AI agents into a single coherent system — the "OS" on top of which company workflows run. Broader than a single app; a platform play for enterprise AI.',
    keywords: [
      /ai (os|operating system) for (companies|enterprise|business)/i,
      /unified (platform|layer|system) for (ai|enterprise|company)/i,
      /company (os|operating system)/i,
      /enterprise (platform|ai platform)/i,
      /single pane (of glass)?/i,
    ],
  },
];

function scoreAlignment(
  ideaDescription: string,
  category: typeof YC_S26_CATEGORIES[number]
): RFSCategory {
  const text = ideaDescription.toLowerCase();
  let matchCount = 0;
  const matchedKeywords: string[] = [];

  for (const kw of category.keywords) {
    if (kw.test(text)) {
      matchCount++;
      matchedKeywords.push(kw.source);
    }
  }

  const maxScore = category.keywords.length;
  const rawScore = matchCount / maxScore;
  const alignment_score = Math.round(rawScore * 100);

  let fit: Fit;
  if (alignment_score >= 60) fit = 'strong';
  else if (alignment_score >= 30) fit = 'moderate';
  else if (alignment_score >= 10) fit = 'weak';
  else fit = 'none';

  const alignment_reasoning =
    matchCount > 0
      ? `Matched ${matchCount}/${maxScore} keyword patterns. Signals: ${matchedKeywords.slice(0, 3).join(', ')}.`
      : 'No keyword match. Idea may not align with this category, or description uses different terminology. Review manually.';

  return {
    name: category.name,
    description: category.description,
    alignment_score,
    alignment_reasoning,
    fit,
  };
}

export function registerFindYCRFSAlignment(server: McpServer): void {
  server.registerTool(
    'find_yc_rfs_alignment',
    {
      description:
        `Assess alignment between a product idea and YC's Request for Startups (${RFS_VINTAGE}). Uses static dataset — update quarterly. Returns scored alignment across all 6 YC S26 categories.`,
      inputSchema: {
        idea_description: z
          .string()
          .describe('Product idea description to align with YC RFS categories'),
      },
    },
    async ({ idea_description }) => {
      const categories = YC_S26_CATEGORIES.map((cat) => scoreAlignment(idea_description, cat));
      categories.sort((a, b) => b.alignment_score - a.alignment_score);

      const topMatch = categories[0];

      let verdict: string;
      if (topMatch.fit === 'strong') {
        verdict = `Strong YC S26 RFS alignment with "${topMatch.name}" (score: ${topMatch.alignment_score}/100). This category is actively being funded by YC — a strong Why Now signal.`;
      } else if (topMatch.fit === 'moderate') {
        verdict = `Moderate alignment with "${topMatch.name}" (score: ${topMatch.alignment_score}/100). Refine your positioning to align more explicitly with YC's framing to maximize signal strength.`;
      } else if (topMatch.fit === 'weak') {
        verdict = `Weak alignment with "${topMatch.name}" (score: ${topMatch.alignment_score}/100). YC RFS is not a strong Why Now signal for this idea — seek other catalysts.`;
      } else {
        verdict = `No clear YC S26 RFS alignment found. This is neither a positive nor a negative signal — YC RFS covers only a slice of fundable ideas. Does not affect gate scoring.`;
      }

      const source: ToolSource = {
        url: RFS_SOURCE_URL,
        tier: 'A',
        // YC RFS reflects YC's strategic priorities — conflicted per spec §4 rule 6 (positioning evidence)
        bias: 'conflicted',
        fetched_at: new Date().toISOString(),
        contribution: `YC ${RFS_VINTAGE} Request for Startups — YC's strategic priorities (positioning signal, not endorsement). Not a funding commitment.`,
      };

      const result: ToolResult<FindYCRFSAlignmentData> = okResult(
        {
          categories,
          top_match: topMatch.name,
          verdict,
          rfs_vintage: RFS_VINTAGE,
        },
        [source],
        `Static dataset — YC S26 RFS baked in. Update quarterly or when YC publishes a new RFS. Keyword matching is heuristic — manual review recommended for borderline scores.`,
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
