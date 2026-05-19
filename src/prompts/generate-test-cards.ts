import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerGenerateTestCardsPrompt(server: McpServer): void {
  server.prompt(
    'generate_test_cards',
    {
      idea: z.string().describe('The product idea to generate test cards for'),
      prior_report: z
        .string()
        .optional()
        .describe('Optional prior validation report summary to tie test cards to lowest-confidence gates'),
      risk_focus: z
        .enum(['desirability', 'viability', 'feasibility'])
        .optional()
        .describe('Optional risk category to weight hypotheses toward'),
    },
    ({ idea, prior_report, risk_focus }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Generate 3-7 testable hypotheses in Strategyzer Test Card format for the product idea below.

RULES:
1. Each hypothesis must be SPECIFIC and FALSIFIABLE — not "users want this" but "B2B ops managers will pay $49/mo for automated report generation"
2. Each test must be the CHEAPEST possible test — never "build it and see"
3. Valid cheap tests: landing page with email capture, 5 customer interviews, fake-door (button that doesn't work), data scraping, concierge (manual delivery of the promised value), cold outreach with specific ask
4. NEVER propose "build a prototype" or "ship an MVP" as the test — that's not a test, it's the product
5. Success thresholds must be SPECIFIC numbers, not "good engagement"
${prior_report ? '6. Tie test cards to the lowest-confidence or failed gates in the prior report' : '6. Identify the 3 riskiest assumptions and test those first'}
${risk_focus ? `7. Weight hypotheses toward ${risk_focus} risk (${risk_focus === 'desirability' ? 'do people want this?' : risk_focus === 'viability' ? 'will people pay?' : 'can we actually build and deliver this?'})` : ''}

${prior_report ? `PRIOR REPORT CONTEXT:\n${prior_report}\n\n` : ''}

OUTPUT FORMAT:

## Test Cards for: ${idea}

${risk_focus ? `**Risk Focus:** ${risk_focus}` : '**Risk Focus:** Balanced (all three risk types)'}

---

**H1: [Specific testable claim]**
- We believe: [hypothesis — who will do what under what conditions]
- To verify, we will: [specific test method — e.g., "Run a $200 Facebook ad to a landing page"]
- We measure: [exact metric — e.g., "email sign-up conversion rate"]
- We're right if: [specific success threshold — e.g., ">5% conversion on 500 unique visitors"]
- Linked to gate: [G1 Competitor / G2 Market / G3 Platform / G4 WTP / G5 Why Now]
- Cheapest test: [test type from approved list]
- Estimated cost: [$X or "Free"]
- Time to run: [N days/weeks]

[Repeat for H2 through H7]

---

## Test Sequencing Recommendation
[Which test to run first and why — prioritize tests that could kill the idea cheapest and fastest]

## Tests NOT Included
[List any tests that were considered but excluded because they are too expensive, too slow, or constitute building the product]

Idea: ${idea}`,
          },
        },
      ],
    })
  );
}
