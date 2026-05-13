import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerSniffUnitEconomicsPrompt(server: McpServer) {
  server.prompt(
    'sniff_unit_economics',
    {
      idea: z.string().describe('The product idea'),
      target_segment: z
        .string()
        .describe('Who is the primary customer? e.g. "individual knowledge workers", "SMB finance teams", "developers"'),
      price_hypothesis: z
        .string()
        .optional()
        .describe('What do you think you\'d charge? e.g. "$12/month per seat"'),
    },
    ({ idea, target_segment, price_hypothesis }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Run a unit economics sniff test on this idea. This is not a financial model — it's a 5-minute sanity check to see if the business can fundamentally work. Use category comparables and first-principles reasoning.

## The Idea
${idea}

## Target Segment
${target_segment}
${price_hypothesis ? `\n## Founder's Price Hypothesis\n${price_hypothesis}` : ''}

## Sniff Test Framework

### 1. Price Ceiling
What is the maximum a user in this segment would realistically pay?
Reference points:
- Individual consumer productivity: $5-15/month (Notion, Todoist, Bear)
- Individual professional tool: $10-30/month (Linear, Raycast, Superhuman)
- SMB team tool: $20-50/seat/month (Slack, Figma, Asana)
- B2B with ROI story: $100-500/seat/month (Salesforce, Workday)
- Enterprise: $1000+/seat/year (procurement process required)

At what price does 50% of the target segment balk?

### 2. Churn Pattern
Is this an "ADHD tax" category or a sticky workflow tool?

ADHD-tax categories (buy in moment of motivation, abandon after 2 weeks):
- Focus apps, habit trackers, fitness apps, journaling apps, self-improvement tools
- Typical annual churn: 60-80%
- LTV is destroyed by churn even at good initial conversion

Sticky workflow tools (embedded in daily work, painful to leave):
- CRMs, project management, accounting, code review, CI/CD
- Typical annual churn: 10-25%
- LTV compounds over time

### 3. CAC Channel Assessment
Is the target user reachable cheaply?

Cheap channels (CAC < $50):
- Developer communities (HN, GitHub, dev.to) — trust-based
- ProductHunt launches — attention spikes
- Twitter/X founder-brand — founder is the marketing
- Content marketing with strong SEO play

Expensive channels (CAC > $200):
- Consumer social ads (Facebook, Instagram, TikTok)
- B2B outbound sales (SDRs, demos, procurement)
- Influencer marketing without community ownership

Structural CAC question: Is this founder text-message-friendly with 5-10 target customers? If yes, first 5 customers are $0 CAC. If no, they're paying market rate.

### 4. LTV / CAC Math
Back-of-envelope:
- Monthly revenue per user: [price]
- Expected months before churn: [12 / annual_churn_rate]
- LTV = monthly_revenue × avg_months
- Minimum viable CAC: LTV / 3 (rule of thumb for payback period)

### 5. Comparable Category Verdict
What category does this most resemble? What do we know about that category's unit economics?
- Productivity-for-individuals: brutal. Low ceiling, high churn, high CAC vs. willingness to pay.
- B2B workflow tool: viable. Price ceiling higher, churn lower, sales motion requires investment.
- Developer tool: possible. Viral within orgs, low initial CAC, but free tier is expected.

## Output Format
PRICE CEILING: [$X/month] — [reasoning]
CHURN PATTERN: [ADHD-tax / Sticky / Unknown] — [comparable categories]
CAC CHANNEL: [Cheap / Expensive / Mixed] — [most viable channel and why]
ESTIMATED LTV: [$X] at [Y]% annual churn
MINIMUM VIABLE CAC: [$X]
UNIT ECONOMICS VERDICT: [VIABLE / MARGINAL / BROKEN]
CATEGORY COMP: [Most similar existing category and what its P&L looks like]
KEY RISK: [The single assumption that, if wrong, breaks the model]`,
          },
        },
      ],
    }),
  );
}
