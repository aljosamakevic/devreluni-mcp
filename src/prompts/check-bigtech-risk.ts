import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerCheckBigTechRiskPrompt(server: McpServer) {
  server.prompt(
    'check_bigtech_risk',
    {
      idea: z.string().describe('The product idea to assess'),
      primary_platform: z
        .enum(['ios', 'android', 'macos', 'windows', 'web', 'cross-platform'])
        .optional()
        .describe('Primary platform the product runs on'),
    },
    ({ idea, primary_platform }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Assess the big-tech encroachment risk for this product idea. Be direct. This is not about whether big tech is evil — it's about whether the founder is building on a road that Apple, Google, or Microsoft is already paving through their house.

## The Idea
${idea}
${primary_platform ? `\nPrimary Platform: ${primary_platform}` : ''}

## Assessment Framework

### Tier 1: Existential Risk (build = definitely get killed)
- Requires OS-level access to be great → Apple/Google will restrict or replicate
- Default app status is central to the value proposition → incumbents have home-field advantage
- Hardware integration (sensors, microphone, camera access patterns) → OS vendors control the API
- Core utility that Apple/Google has already shipped in a worse version → they'll ship v2

### Tier 2: High Risk (5-year window, then commoditized)
- Productivity enhancement for their own apps (Calendar, Notes, Mail) → they integrate it natively
- Screen time / app usage monitoring → Apple Screen Time, Android Digital Wellbeing
- Basic task management → Google Tasks, Apple Reminders, Microsoft To Do
- Calendar AI → Google Assistant, Microsoft Copilot
- Writing assistance → Apple Intelligence, Google Gemini in Docs

### Tier 3: Moderate Risk (builds value before encroachment)
- Cross-platform tools where incumbents can't dominate all platforms simultaneously
- Vertical-specific workflows where Apple/Google have no incentive to go narrow
- B2B with deep integration requirements (they want you to build this)

### Tier 4: Low Risk
- Proprietary data moat that's impossible to replicate without the same user base
- Incumbent would need to acquire customers in a vertical they don't serve
- Network effects require a community that incumbent can't conjure

## What to Assess
1. What specific OS primitives does this product depend on?
2. Has Apple, Google, or Microsoft already shipped a worse version of this?
3. Is there a WWDC/Google I/O announcement in the last 2 years that's adjacent?
4. What would it take for this to be a system setting rather than a third-party app?
5. Does the product get better as the OS improves, or does it get killed?

## Output Format
ENCROACHMENT RISK: [EXISTENTIAL / HIGH / MODERATE / LOW]
MOST LIKELY ACQUIRER/KILLER: [Apple / Google / Microsoft / None]
ESTIMATED RUNWAY BEFORE COMMODITIZATION: [<12 months / 1-3 years / 3-5 years / unlikely]
EVIDENCE: [Specific products/features/announcements that support this assessment]
STRUCTURAL HEDGE: [What would need to be true about this product for it to survive commoditization]`,
          },
        },
      ],
    }),
  );
}
