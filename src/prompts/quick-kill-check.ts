import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerQuickKillCheckPrompt(server: McpServer): void {
  server.prompt(
    'quick_kill_check',
    {
      idea: z.string().describe('The product idea to triage'),
      audience: z
        .enum(['B2B', 'B2C', 'B2B2C', 'dev_tools'])
        .optional()
        .describe('Target audience type'),
      builder: z
        .enum(['solo', 'small_team', 'funded'])
        .optional()
        .describe('Builder type'),
    },
    ({ idea, audience, builder }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are running a 60-second kill check on a product idea. This is a shallow triage — NOT a full validation.

RULES:
1. Call at most 4 tools: find_closest_competitor → read_competitor_changelog (top result only) → find_pricing_anchors (top 2 competitors only)
2. Skip full DOK layering — keep tier+bias labels on all cited facts
3. Look ONLY for these 4 kill conditions:
   a. Incumbent with 12+ months head start AND growing traction (not stagnant)
   b. FAANG/Big Tech already in space or shipping in next 12 months
   c. Pricing data shows category cannot sustain the builder's economic target
   d. "Killed by platform" signal in competitor changelogs
4. NEVER issue a GO verdict from this prompt
5. "No obvious kill" = "no red flag in shallow check" — NOT validation
6. If any kill condition is found with HIGH-CONFIDENCE (S/A tier) evidence: return SUSPECTED NO-GO

${audience && builder ? `Framing: ${audience} × ${builder}` : 'Framing not specified — use conservative thresholds.'}

OUTPUT FORMAT:

## Quick Kill Check: ${idea}

**Framing:** ${audience ?? 'not specified'} × ${builder ?? 'not specified'}

### Tools Run
[List of tools called]

### Kill Condition Scan

**a. Incumbent with 12+ months head start + growing traction:**
[Evidence found or "Not found in shallow check"]

**b. FAANG / Big Tech in space or shipping soon:**
[Evidence found or "Not found in shallow check"]

**c. Pricing incompatible with economic target:**
[Evidence found or "Not found in shallow check"]

**d. "Killed by platform" in competitor changelogs:**
[Evidence found or "Not found in shallow check"]

---

## Verdict

${`**[SUSPECTED NO-GO / NO OBVIOUS KILL FOUND]**`}

[If SUSPECTED NO-GO:]
**Kill Reason:** [One sentence citing specific S/A-tier fact]
**Citation:** [URL | Tier: X | Bias: X]
**Recommendation:** Walk away OR run full validate_idea to confirm.

[If NO OBVIOUS KILL:]
**No obvious kill found in shallow check.**
This is NOT validation. Full validation strongly recommended before building.
Run: validate_idea for the complete 5-gate analysis.

---

⚠️ Disclaimer: This is a 60-second triage based on shallow search. A clean quick_kill_check does not mean the idea is validated — it means no red flag was immediately visible. Approximately 40% of ideas that pass quick_kill_check fail on full validation.

Idea: ${idea}`,
          },
        },
      ],
    })
  );
}
