import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerAssessFounderEdgePrompt(server: McpServer) {
  server.prompt(
    'assess_founder_edge',
    {
      founder_background: z
        .string()
        .describe('What you\'ve built, where you\'ve worked, what communities you\'re in, what you know deeply'),
      idea: z.string().describe('The product idea'),
      claimed_advantages: z
        .string()
        .optional()
        .describe('Any advantages you believe you have for this specific idea'),
    },
    ({ founder_background, idea, claimed_advantages }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Assess whether this founder has a structural unfair advantage for this specific idea. Push hard on this. "I have the problem too" is not an advantage — everyone does. Find what's structural.

## The Idea
${idea}

## Founder Background
${founder_background}
${claimed_advantages ? `\n## Claimed Advantages\n${claimed_advantages}` : ''}

## The Natal Studio / YC Lens
In the age of AI, any software product can be replicated in weeks. The model, the UI, the features — none of it is a moat anymore.

Only two structural advantages survive in 2026:

**1. Proprietary Data**
Data from private workflows that doesn't exist on the public internet. Every interaction makes the product smarter in a way competitors can't replicate. This is a flywheel: more users → more data → smarter product → more users.

Key question: Does the founder have access to private workflow data that would be impossible to acquire without already having the users? Examples: anonymized outputs from a prior product, exclusive partnerships with enterprises, data from a community they own.

**2. Distribution**
Existing customer relationships, community, or audience that capital can't buy in a year. This is not paid acquisition — that's not a moat. This is people who would take your call, try your beta, and tell their colleagues.

Key question: Is this founder text-message-friendly with 5-10 people who are the target customer? Not "I know people in this space" — specifically: would they take an unprompted text saying "I built something, can you try it?"

## Assessment Rubric

### Proprietary Data Advantage
- Does the founder have access to data that a competitor couldn't acquire without already having users?
- Does normal product usage generate data that makes the product smarter over time?
- Is there a flywheel: more users → more proprietary signal → better product?

Structural (moat): exclusive data access, prior product with data, enterprise partnership
Feature (not a moat): building a great data model, scraping public data, using the same LLMs as everyone

### Distribution Advantage
- Does the founder have an existing audience in the target market?
- Are they known and trusted in the community they're selling to?
- Could they get 5 paying users without advertising?

Structural (moat): existing community, prior company with same customers, deep domain reputation
Feature (not a moat): "I'll build an audience," good at content marketing, network is adjacent but not exact

### Domain Expertise
- Does the founder understand this problem at a depth competitors can't quickly replicate?
- Is the expertise from lived experience in a private context (not just public research)?
- Would 10 hours of reading get a smart person to the same place?

### Speed Advantage
(Weak but sometimes real)
- Is the founder 12+ months ahead on product intuition because they've lived the problem?
- Would they make better product decisions than a funded competitor for the first 18 months?

## The Hard Question
Could a well-funded competitor (e.g. $2M seed, 3 engineers) replicate every claimed advantage in 12 months?
- If yes → it's a feature, not a moat
- If no → explain specifically why not

## Output Format
PROPRIETARY DATA ADVANTAGE: [STRUCTURAL / FEATURE-LEVEL / NONE] — [evidence]
DISTRIBUTION ADVANTAGE: [STRUCTURAL / FEATURE-LEVEL / NONE] — [evidence]
DOMAIN EXPERTISE: [DEEP / SURFACE / NONE] — [evidence]
OVERALL FOUNDER-MARKET FIT: [STRONG / MODERATE / WEAK]
REPLICATION TEST: [Can a $2M competitor replicate this in 12 months? YES/NO — why]
VERDICT: [This founder should / should not build this idea, specifically because...]
PUSH BACK: [The one claim in the founder's background that sounds like an advantage but isn't structural]`,
          },
        },
      ],
    }),
  );
}
