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
6. Your terminal output is a JSON \`ValidationReport\` consumed by the \`finalize_validation_report\` tool. You do NOT author the markdown artifact. The tool validates and renders it.
7. If a tool call fails or returns nothing, log it in the methodology_notes.tool_calls array. Never fabricate.
8. Adapt evaluation criteria per framing using the Evaluation Lens Matrix resource.

RESOURCES TO LOAD BEFORE STARTING:
- Load resource: resource://source-tier-bias (tier and bias reference)
- Load resource: resource://tool-to-gate-map (which tools to call per gate)
- Load resource: resource://evaluation-lens-matrix (framing-specific pass/fail thresholds)

WORKFLOW:

Step 0 — Framing
Restate framing. If audience/builder not provided, ask before proceeding.

Step 1 — Run Gates 1-5 (each producing DOK-layered blocks)

TOOL CALLING CONVENTION (read before your first tool call): every gate tool takes \`idea_description: string\` as the primary argument — NOT \`idea\`, NOT \`description\`, NOT \`query\`. Most tools also accept optional tool-specific args (e.g. \`category\`, \`category_keywords\`, \`explicit_platforms\`); inspect each tool's \`inputSchema\` from \`tools/list\` before invoking. If a tool call returns \`isError: true\` with a path like \`["idea_description"] Required\`, you used the wrong argument name — fix and retry, do not interpret the error as a server timeout.

For each gate:
  a. Identify relevant tools from Tool-to-Gate Map resource
  b. Call tools (pass \`idea_description\` + any tool-specific args from the schema). Enter facts as DOK 1 with tier+bias citations
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

Each check outputs one of: No issues / Minor / Major / Fundamental

Step 3 — Apply Validation Decision Matrix
  All checks passed → render verdict as calculated from Fail-2 rule
  Minor issues → render with confidence caveats
  Major issues → downgrade overall confidence to Low
  Fundamental flaws → override to Inconclusive regardless of gate scores
  (The server-side verdict-validator will enforce these — you should still apply them yourself in the JSON you emit.)

Step 4 — Apply Fail-2 Rule
  Count FAIL verdicts across 5 gates.
  2+ FAIL → NO-GO
  1 FAIL or 2+ INCONCLUSIVE → CONDITIONAL GO
  0 FAIL, ≤1 INCONCLUSIVE → GO
  Encode the count in methodology_notes (the server validates it).

Step 5 — "What Would Change This" (3-7 Test Cards)
  Strategyzer Test Card format → emitted as objects in \`test_cards[]\`:
  - belief: "We believe [hypothesis]"
  - verification_method: "To verify, we will [specific test]"
  - metric: "We measure [exact metric]"
  - success_threshold: "We're right if [threshold]"
  - linked_gate: 1-5
  - cheapest_test: landing page / 5 interviews / fake-door / scraping / concierge
  NEVER suggest "build it and see" as a test.

Step 6 — "Your Spiky POV"
  Emit the canonical blank-template string in \`spiky_pov.template\`. The structural validator enforces a byte-for-byte match — do not paraphrase, do not fill it in.

Step 7 — Assemble & Emit JSON

OUTPUT CONTRACT (read carefully — this replaces all prior "output format" guidance):

Do not output any markdown. Your final assistant message must contain exactly one fenced JSON block (a \`ValidationReport\`) followed by a single tool call to \`finalize_validation_report\` with that JSON as the \`report_json\` argument. If you find yourself about to write \`# Idea:\` or \`Verdict:\` or any spec §5 section heading, stop and emit JSON instead. The validated markdown will be returned by the tool — relay that to the user verbatim.

**Before constructing the JSON, load \`resource://report-schema\`.** The resource returns three things: the live JSON Schema (authoritative), a minimal-valid skeleton you can copy and fill in, and a worked example showing a populated NO-GO report. Construct your JSON to match the schema exactly — do not skip this step. If your client cannot list resources, the top-level fields are summarized below as a fallback, but the resource is the source of truth.

Top-level fields (summary — see \`resource://report-schema\` for the exhaustive contract):
- \`header\` — { idea, audience, builder, generated_at, mcp_version (use "0.1.0" if unknown), total_sources_consulted, source_quality_mix: {S,A,B,C,D}, bias_mix: {independent, "vendor-funded", conflicted, unknown} }
- \`verdict\` — { overall, overall_confidence, gate_summary[5], killshots[] (only when NO-GO) }
- \`gates\` — exactly 5 \`GateReport\` objects in order 1..5, each with dok1_facts[], dok2_summary, dok3_insights[] (is_model_judgment: true), contradicting_evidence[] (use the "none found" sentinel if empty), dok4_verdict, source_meta
- \`validation_checks\` — exactly 3, named "Source Quality Audit", "Counterargument Search", "Logic & Coherence Review"
- \`test_cards\` — 3 to 7
- \`spiky_pov\` — { template: <canonical blank template string> }
- \`source_appendix\` — numbered rows with gates/dok_layers
- \`methodology_notes\` — { tool_calls[], tool_calls_fired, validation_rules_in_force, disclaimer }

<retry_policy>
Maximum 2 attempts. If \`finalize_validation_report\` returns \`status: validation_failed\`, the response includes \`expected_skeleton\` (the minimal-valid skeleton — copy its shape) and \`hints[]\` (one per issue, path-localized — e.g. \`gates.2.dok1_facts.3.tier — expected one of "S","A","B","C","D"; got "high"\`). Read them, fix the specific issues, and emit corrected JSON on attempt 2 with a fresh tool call. If attempt 2 also fails, surface the \`validation_failed\` payload to the user verbatim — do NOT attempt to render markdown directly, do NOT make a 3rd attempt, and do NOT skip the finalize step.
</retry_policy>

On \`status: ok\`: relay the tool's \`markdown\` field to the user verbatim. If \`adjustments_made\` is non-empty, append a short "Server-side adjustments:" note listing them so the user knows the verdict-validator overrode something.

ANTI-PATTERN CHECKLIST (before output):
[ ] Every DOK 1 fact has both tier badge AND bias flag
[ ] DOK 3 insights are visibly labeled as ⚠️ model judgment (is_model_judgment: true)
[ ] Every gate has contradicting evidence (or the explicit "none found" sentinel)
[ ] No D-tier source used to validate (only flag concerns)
[ ] All 3 validation checks completed with explicit outcomes
[ ] If >30% deciding-tier sources are conflicted, confidence was downgraded
[ ] Hypotheses propose cheap tests, not "build it and see"
[ ] Killshot reasons (NO-GO) cite specific DOK 1 source URLs, not DOK 3 vibes
[ ] methodology_notes.tool_calls lists tools fired AND tools that failed
[ ] spiky_pov.template equals the canonical blank template verbatim
[ ] Output is JSON only — finalize_validation_report was called
[ ] No markdown headings (## ) appear in my response before the JSON block

Idea: ${idea}
${audience ? `Audience: ${audience}` : 'Audience: [ask user before proceeding]'}
${builder ? `Builder type: ${builder}` : 'Builder type: [ask user before proceeding]'}`,
          },
        },
      ],
    })
  );
}
