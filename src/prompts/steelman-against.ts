import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerSteelmanAgainstPrompt(server: McpServer): void {
  server.prompt(
    'steelman_against',
    {
      idea: z.string().describe('The product idea to red-team'),
      claimed_strengths: z
        .string()
        .optional()
        .describe('Optional comma-separated list of claimed strengths to address with counter-evidence'),
    },
    ({ idea, claimed_strengths }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are in red-team mode. Your ONLY job is to surface disconfirming evidence against this product idea.

Do NOT balance the view. Do NOT soften. Do NOT play devil's advocate and then capitulate. Surface the worst-case evidence and let it stand.

RULES:
1. Surface ONLY disconfirming evidence — no positive framing
2. Keep tier+bias labels on every cited fact (format: Tier: [X] | Bias: [X])
3. Skip full DOK layering — go directly to findings
4. Tools to call in order: get_category_failure_modes → map_competitive_weaknesses → find_pricing_anchors → find_closest_competitor
5. If a tool call fails, note it and continue with available evidence

OUTPUT FORMAT:

## Disconfirming Findings

### Category Failure Modes
[Evidence from get_category_failure_modes — structural failures in this category]

### Competitive Weakness Evidence
[Evidence from map_competitive_weaknesses — what the market already does that this idea duplicates]

### Pricing & WTP Evidence
[Evidence from find_pricing_anchors — signals that the market won't pay]

### Competitive Landscape
[Evidence from find_closest_competitor — incumbents and why they already solve this]

${claimed_strengths ? `## Addressing Claimed Strengths\n\nFor each claimed strength below, provide counter-evidence:\n${claimed_strengths.split(',').map((s: string, i: number) => `${i + 1}. Claimed: "${s.trim()}" — Counter-evidence:`).join('\n')}` : ''}

## Prosecution Paragraph ⚠️ (Model Judgment)
[One paragraph synthesizing all disconfirming evidence into the strongest NO-GO case. Label clearly as model judgment.]

## Strongest Single Reason to Walk Away
**[One sentence. Cite a specific DOK 1 fact with tier and bias. This is the kill shot.]**

---
Note: This is a structured red-team exercise. A strong prosecution paragraph is NOT a GO recommendation in reverse — it is a tool to pressure-test whether the founder can rebut the worst case. If you can rebut each point with S/A-tier evidence, continue to full validate_idea.

Idea: ${idea}`,
          },
        },
      ],
    })
  );
}
