import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerValidateIdeaPrompt(server: McpServer): void {
  server.prompt(
    'validate_idea',
    {
      idea: z.string().describe('The product idea to validate'),
      audience: z
        .enum(['B2B', 'B2C', 'B2B2C', 'dev_tools'])
        .optional()
        .describe('Target audience type'),
      builder: z
        .enum(['solo', 'small_team', 'funded'])
        .optional()
        .describe('Builder type (affects gate thresholds)'),
    },
    ({ idea, audience, builder }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are running a structured product idea validation using the Pre-Build Checklist framework.
Your job is to produce a verdict (GO / NO-GO / CONDITIONAL GO) backed by DOK-layered, sourced evidence across 5 gates, then audit your own verdict through three structured validation checks.

${!audience || !builder ? 'IMPORTANT: audience and/or builder type not provided. Ask for both before proceeding. Do not begin gate analysis until both are confirmed.' : `Framing confirmed: Audience = ${audience}, Builder = ${builder}`}

${builder === 'solo' ? 'Economic target: lifestyle — $5k-50k MRR' : ''}
${builder === 'small_team' ? 'Economic target: $50k-500k MRR' : ''}
${builder === 'funded' ? 'Economic target: $10M+ ARR' : ''}

OPERATING RULES (non-negotiable):
1. EVERY DOK 1 fact must carry TWO labels: tier badge [S/A/B/C/D] AND bias flag [independent/vendor-funded/conflicted/unknown]
2. DOK layers must be strictly separated:
   - DOK 1: Objective data — facts with source citations
   - DOK 2: Summary — plain restatement of facts, no interpretation
   - DOK 3: Insights — explicitly labeled as model judgment ⚠️
   - DOK 4: Verdicts — judgment calls based on DOK 1-3
3. For each gate, search for CONTRADICTING evidence before issuing DOK 4. If none found, write explicitly: "No contradicting evidence surfaced — treat as a gap, not confirmation."
4. PASS requires ≥2 tier-B-or-higher sources. C/D-only evidence = automatic Inconclusive. If >30% deciding-tier sources are conflicted → downgrade confidence.
5. Fail-2 rule: 2+ fails = NO-GO. 1 fail or 2+ inconclusive = CONDITIONAL GO. 0 fails ≤1 inconclusive = GO.
6. Output MUST match the Idea Validation Report format defined below.
7. If a tool call fails or returns nothing, log it in Methodology Notes. Never fabricate.
8. Adapt evaluation criteria per framing using the Evaluation Lens Matrix resource.

RESOURCES TO LOAD BEFORE STARTING:
- Load resource: resource://source-tier-bias (tier and bias reference)
- Load resource: resource://tool-to-gate-map (which tools to call per gate)
- Load resource: resource://evaluation-lens-matrix (framing-specific pass/fail thresholds)

WORKFLOW:

Step 0 — Framing
Restate framing. If audience/builder not provided, ask before proceeding.

Step 1 — Run Gates 1-5 (each producing DOK-layered blocks)
For each gate:
  a. Identify relevant tools from Tool-to-Gate Map resource
  b. Call tools. Enter facts as DOK 1 with tier+bias citations
  c. Write DOK 2 summary (plain language, no interpretation)
  d. Write DOK 3 insights (LABEL as "⚠️ Model judgment:")
  e. Search for contradicting evidence — add to Contradicting Evidence block
  f. Write DOK 4 gate verdict ONLY after step (e) is complete

Gates:
  Gate 1 (G1): Competitor Landscape — Is the space occupied?
  Gate 2 (G2): Market Demand — Is there real, measurable demand?
  Gate 3 (G3): Platform / Moat Risk — Can a platform or incumbent kill this?
  Gate 4 (G4): Willingness to Pay — Will people actually pay?
  Gate 5 (G5): Why Now — Is this the right moment?

Step 2 — Three Validation Checks (run AFTER all 5 gates)
Check 1: Source Quality Audit
  - Authority: Are sources credible and relevant?
  - Recency: Are sources current (< 18 months)?
  - Citation: Every DOK 1 fact has URL + tier + bias?
  - Bias: Are conflicted sources >30% of deciding tier?
  - Primary vs Secondary: Is the analysis grounded in primary data?

Check 2: Counterargument Search
  - Who are the critics of this idea type?
  - What is the strongest NO-GO case?
  - What are the non-obvious alternatives a user might choose?
  - What analogous ideas failed, and why?

Check 3: Logic & Coherence Review
  - Evidence-claim ratio: Does the evidence actually support the claims?
  - Fallacies: Any confirmation bias, appeal to trends, or excluded middle?
  - Consistency: Do gate conclusions contradict each other?
  - Scope: Is the verdict scoped correctly for the framing?

Each check outputs one of: No issues / Minor issues / Major issues / Fundamental flaws

Step 3 — Apply Validation Decision Matrix
  All checks passed → render verdict as calculated from Fail-2 rule
  Minor issues → render with confidence caveats
  Major issues → downgrade overall confidence to Low
  Fundamental flaws → override to Inconclusive regardless of gate scores

Step 4 — Apply Fail-2 Rule
  Count FAIL verdicts across 5 gates.
  2+ FAIL → NO-GO
  1 FAIL or 2+ INCONCLUSIVE → CONDITIONAL GO
  0 FAIL, ≤1 INCONCLUSIVE → GO
  Show the math in Methodology Notes.

Step 5 — "What Would Change This" (3-7 Test Cards)
  Strategyzer Test Card format:
  H[n]: [Specific testable claim]
  - We believe: [hypothesis]
  - To verify, we will: [specific test method]
  - We measure: [exact metric]
  - We're right if: [success threshold]
  - Linked to gate: [G1/G2/G3/G4/G5]
  - Cheapest test: [landing page / 5 interviews / fake-door / scraping / concierge]
  NEVER suggest "build it and see" as a test.

Step 6 — "Your Spiky POV"
  Leave this section completely blank. User fills it in.
  Label: "## Your Spiky POV — [Leave blank — complete this yourself]"

Step 7 — Assemble Full Artifact

OUTPUT FORMAT (Idea Validation Report):

## Section 1: Header
- Idea: [stated idea]
- Framing: [audience] × [builder]
- Date: [today's date]
- Source quality mix: [count of S/A/B/C/D tier sources used]

## Section 2: Verdict (above the fold)
**VERDICT: [GO / NO-GO / CONDITIONAL GO]**
| Gate | Result | Confidence |
|------|--------|------------|
| G1 Competitor Landscape | PASS/FAIL/INCONCLUSIVE | High/Medium/Low |
| G2 Market Demand | ... | ... |
| G3 Platform Risk | ... | ... |
| G4 Willingness to Pay | ... | ... |
| G5 Why Now | ... | ... |

Killshot Reasons (if NO-GO): [cite specific DOK 1 facts, not DOK 3 vibes]
Overall Confidence: [High/Medium/Low]

## Section 3: Evidence Report
[One DOK-layered block per gate]

### Gate N: [Name]
**DOK 1 — Facts:**
[facts with source citations in format: [Fact] — Source: [URL] | Tier: [X] | Bias: [X] | Fetched: [date]]

**DOK 2 — Summary:**
[plain language restatement]

**DOK 3 — Insights:** ⚠️ Model judgment
[interpretation, labeled]

**Contradicting Evidence:**
[disconfirming evidence found, or: "No contradicting evidence surfaced — treat as a gap, not confirmation."]

**DOK 4 — Gate Verdict:**
[PASS / FAIL / INCONCLUSIVE] — [one paragraph judgment with confidence level]

## Section 4: Validation Checks
[All 3 checks with explicit outcomes]

## Section 5: What Would Change This
[3-7 Test Cards in Strategyzer format]

## Section 6: Your Spiky POV
[BLANK — user completes this]

## Section 7: Source Appendix
| URL | Tier | Bias | Date | Contribution | Gates Informed |
|-----|------|------|------|--------------|----------------|

## Section 8: Methodology Notes
- Tools fired: [list]
- Tools that failed or returned nothing: [list, or "None"]
- Fail-2 rule math: [show the count]
- Source tier definitions: See resource://source-tier-bias
- Disclaimer: This report reflects evidence available at the time of generation. Markets change. No gate verdict constitutes investment or product advice.

ANTI-PATTERN CHECKLIST (verify before outputting):
[ ] Every DOK 1 fact has both tier badge AND bias flag
[ ] DOK 3 insights are visibly labeled as ⚠️ model judgment
[ ] Every gate has contradicting evidence (or explicit "none found")
[ ] No D-tier source used to validate (only flag concerns)
[ ] All 3 validation checks completed with explicit outcomes
[ ] If >30% deciding-tier sources are conflicted, confidence was downgraded
[ ] Hypotheses propose cheap tests, not "build it and see"
[ ] Killshot reasons (NO-GO) cite specific DOK 1 facts, not DOK 3 vibes
[ ] Methodology Notes lists tools fired AND tools that failed
[ ] "Your Spiky POV" is present but BLANK

Idea: ${idea}
${audience ? `Audience: ${audience}` : 'Audience: [ask user before proceeding]'}
${builder ? `Builder type: ${builder}` : 'Builder type: [ask user before proceeding]'}`,
          },
        },
      ],
    })
  );
}
