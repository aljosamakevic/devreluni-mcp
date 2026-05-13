import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerValidateIdeaPrompt(server: McpServer) {
  server.prompt(
    'validate_idea',
    {
      idea: z.string().describe('The product idea in one or two sentences'),
      founder_context: z
        .string()
        .optional()
        .describe('Brief background: what you\'ve built, who you know, what communities you\'re in'),
      target_customer: z
        .string()
        .optional()
        .describe('Who is the specific person with this problem? Not a segment — a person.'),
    },
    ({ idea, founder_context, target_customer }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `You are running a product idea through the Pre-Build Checklist. Your job is to find the kill shot first — if there's a fatal flaw, surface it immediately, not buried in a balanced analysis. Time-box this to what would take 90 minutes of research. Enough to pass or fail the checklist, not a comprehensive market study.

## The Idea
${idea}

${target_customer ? `## Target Customer\n${target_customer}\n` : ''}
${founder_context ? `## Founder Context\n${founder_context}\n` : ''}

## Pre-Build Checklist (Fail any 2 of 5 = pass on the idea)

Run each criterion using the available tools. For each, return a PASS, FAIL, or UNCERTAIN with one-paragraph reasoning.

### 1. Direct Competitor Scan
Use \`find_closest_competitor\` to find the nearest existing product.
Then use \`read_competitor_changelog\` on the top result.
- Does a direct competitor exist with 12+ months head start?
- What did their changelog reveal about where their pitch met reality?
- Does independent convergence with their framing validate the insight AND confirm competition?

### 2. Market Structure
Use \`scan_producthunt_launches\` and \`get_category_failure_modes\` for context.
- Is this winner-take-most (network effects, data moats) or room for many (workflow tools, vertical SaaS)?
- If winner-take-most and an incumbent exists: what's the bar to clear?
- Focus apps, social networks, marketplaces = winner-take-most
- B2B workflow tools, vertical SaaS, dev tools = often room for many

### 3. Big-Tech Encroachment Risk
No tool call needed — reason from the idea description.
- Could Apple / Google / Microsoft ship this as a system primitive in 24 months?
- Does it require OS-level access, default app status, or hardware integration to be great?
- If yes → building on a road they're paving through your house.

### 4. Unit Economics Sniff Test
Use \`get_category_failure_modes\` for category comps.
- Price ceiling: what's the max a user would realistically pay?
- Churn pattern: ADHD-tax category (buy and abandon) or sticky workflow tool?
- CAC: is the target user reachable cheaply or expensive?
- Productivity-for-individuals = one of the worst SaaS verticals.

### 5. Unfair Advantage
Use the founder context provided.
- Beyond "I have the problem too" — what's structural?
- Proprietary data from private workflows?
- Existing distribution (community, audience, relationships)?
- Hard integrations that take months to negotiate?
- Test: could a well-funded competitor replicate this advantage in 12 months?

## Defensibility Check (Natal Studio Lens)
In the age of AI, UI, model, and features are cloneable in weeks. Only two moats survive:
1. Proprietary data — generated as a byproduct of normal usage, unavailable on the public internet
2. Distribution — existing customer relationships, community, or audience that capital can't buy in a year

Does this idea generate proprietary data as a byproduct of normal usage?
Does the founder have asymmetric distribution for this specific idea?
If neither → the product needs to be 10x better on one axis to win, not 1.5x better on three.

## YC RFS Signal
Use \`find_yc_rfs_alignment\` to check market timing.

## Output Format
Return a structured scorecard:

CHECKLIST RESULTS:
1. Direct Competitor: [PASS/FAIL/UNCERTAIN] — [one-paragraph reasoning]
2. Market Structure: [PASS/FAIL/UNCERTAIN] — [one-paragraph reasoning]
3. Big-Tech Risk: [PASS/FAIL/UNCERTAIN] — [one-paragraph reasoning]
4. Unit Economics: [PASS/FAIL/UNCERTAIN] — [one-paragraph reasoning]
5. Unfair Advantage: [PASS/FAIL/UNCERTAIN] — [one-paragraph reasoning]

VERDICT: [GO / NO-GO / NEEDS MORE INFO]
FAIL COUNT: [X/5]
KILL SHOT (if any): [The single most fatal flaw, stated plainly]
NEXT STEP: [If GO — what to validate next. If NO-GO — what idea direction might pass.]

Do not soften the verdict. A clear NO-GO in 90 minutes saves 12-18 months.`,
          },
        },
      ],
    }),
  );
}
