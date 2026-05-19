import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerRunSingleGatePrompt(server: McpServer): void {
  server.prompt(
    'run_single_gate',
    {
      idea: z.string().describe('The product idea to evaluate'),
      gate: z
        .enum(['competitor', 'market', 'platform', 'wtp', 'why_now'])
        .describe('Which gate to run: competitor=G1, market=G2, platform=G3, wtp=G4, why_now=G5'),
      audience: z
        .enum(['B2B', 'B2C', 'B2B2C', 'dev_tools'])
        .optional()
        .describe('Target audience type — affects pass/fail thresholds'),
      builder: z
        .enum(['solo', 'small_team', 'funded'])
        .optional()
        .describe('Builder type — affects pass/fail thresholds'),
    },
    ({ idea, gate, audience, builder }) => {
      const gateMap: Record<string, { num: string; name: string; primaryTools: string[] }> = {
        competitor: {
          num: 'G1',
          name: 'Competitor Landscape',
          primaryTools: ['find_closest_competitor', 'read_competitor_changelog', 'map_competitive_weaknesses'],
        },
        market: {
          num: 'G2',
          name: 'Market Demand',
          primaryTools: ['estimate_demand_signals', 'find_public_revenue_signals', 'scan_producthunt_launches'],
        },
        platform: {
          num: 'G3',
          name: 'Platform / Moat Risk',
          primaryTools: ['check_big_tech_encroachment', 'assess_platform_dependency', 'read_competitor_changelog'],
        },
        wtp: {
          num: 'G4',
          name: 'Willingness to Pay',
          primaryTools: ['find_pricing_anchors', 'find_public_revenue_signals', 'read_competitor_changelog'],
        },
        why_now: {
          num: 'G5',
          name: 'Why Now',
          primaryTools: ['find_yc_rfs_alignment', 'find_why_now_signals', 'scan_producthunt_launches'],
        },
      };

      const gateInfo = gateMap[gate];

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `You are running a single-gate deep dive on ${gateInfo.num}: ${gateInfo.name}.

Apply the same operating rules as the master validation framework — DOK layering, tier+bias on every fact, contradicting evidence required before verdict.

${audience && builder ? `Framing: ${audience} × ${builder}` : 'If audience/builder not provided, apply the most conservative framing thresholds.'}

LOAD BEFORE STARTING:
- resource://source-tier-bias (tier and bias reference)
- resource://tool-to-gate-map (confirm which tools are primary for ${gateInfo.num})
- resource://evaluation-lens-matrix (framing-specific thresholds for ${gateInfo.num})

OPERATING RULES (non-negotiable):
1. Every DOK 1 fact carries tier badge [S/A/B/C/D] AND bias flag
2. PASS requires ≥2 tier-B-or-higher sources
3. C/D-only evidence = automatic Inconclusive
4. >30% conflicted deciding-tier sources → downgrade confidence one level
5. Search for contradicting evidence before issuing DOK 4. If none found: "No contradicting evidence surfaced — treat as gap, not confirmation."
6. Do NOT run the three Validation Checks (those are for the master workflow only)

TOOLS TO CALL (in priority order):
${gateInfo.primaryTools.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n')}

OUTPUT FORMAT:

## ${gateInfo.num}: ${gateInfo.name} — Deep Dive

**Idea:** ${idea}
**Framing:** ${audience ?? 'not specified'} × ${builder ?? 'not specified'}

---

### DOK 1 — Facts
[All evidence with citations in format: [Fact] — Source: [URL] | Tier: [X] | Bias: [X] | Fetched: [date]]

### DOK 2 — Summary
[Plain language restatement of facts only — no interpretation]

### DOK 3 — Insights ⚠️ (Model Judgment)
[Interpretation, explicitly labeled as model judgment]

### Contradicting Evidence
[Disconfirming evidence, or: "No contradicting evidence surfaced — treat as a gap, not confirmation."]

### DOK 4 — Gate Verdict
**${gateInfo.num} Verdict: [PASS / FAIL / INCONCLUSIVE]**
Confidence: [High / Medium / Low]
[One paragraph judgment]

---

### What This Means for the Overall Idea
[One short paragraph: how this gate's verdict affects the overall product validation — what to watch for, what to investigate next, whether this gate alone could kill or validate the idea]

### Methodology Notes
- Tools fired: [list]
- Tools that failed: [list or "None"]
- Source tier mix: [S: N, A: N, B: N, C: N, D: N]

Idea: ${idea}`,
            },
          },
        ],
      };
    }
  );
}
