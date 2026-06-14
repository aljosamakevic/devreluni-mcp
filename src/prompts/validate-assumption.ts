import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Phase 07 — `validate_assumption` prompt.
 *
 * A focused, claim-level companion to `validate_idea`. Verifies ONE specific
 * factual claim with the same anti-bias property (tier-graded sources, forced
 * contradicting-evidence search, bias flags) but at much lower cost than the
 * full 5-gate sweep.
 *
 * Decision lineage:
 *   - Output shape: verdict + sources (NOT a DOK 1-4 mini-report). Locked by
 *     Aljosa on 2026-06-15. See .planning/phases/07-validate-assumption/CONTEXT.md
 *     decision 1.
 *   - Verdict template rendered VERBATIM in the prompt body (decision 7).
 *   - Three anti-bias mechanics mandated in-line (decision 4):
 *       1. tier-grade every fact (S/A/B/C/D)
 *       2. bias-flag every source (independent / vendor-funded / conflicted / unknown)
 *       3. search for contradicting evidence BEFORE forming the verdict
 *   - No new finalize tool — prompt body specifies the markdown template
 *     directly, the LLM renders inline. Keeps Phase 01's
 *     `finalize_validation_report` untouched (decision 5).
 *
 * Routing groups (encoded below) follow CONTEXT.md decision 3.
 */
export function registerValidateAssumptionPrompt(server: McpServer): void {
  server.prompt(
    'validate_assumption',
    {
      claim: z
        .string()
        .min(1)
        .describe('The specific factual claim to verify (e.g., "Cold Turkey has 80k paying users")'),
      evidence_type: z
        .enum(['competitor_metric', 'pricing', 'demand', 'platform', 'why_now', 'failure_mode'])
        .optional()
        .describe('Routing hint for which tool subset to invoke. Omit to auto-route from the claim shape.'),
    },
    ({ claim, evidence_type }) => {
      const routingLabel = evidence_type ?? '(auto-route)';

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `You are running a single-claim assumption check for Veto. Verify ONE specific factual claim with the same anti-bias rigor as the full validate_idea framework, but at claim granularity. This is NOT a full 5-gate sweep — it is a focused verdict on one claim.

Assumption under test: "${claim}"
Evidence type: ${routingLabel}. ${evidence_type ? `Routing: ${evidence_type}. Call only the tools in that routing group.` : 'Routing: auto-route — choose the routing group based on the claim\'s surface shape, then commit to it. Do not call tools from multiple groups unless the claim is genuinely multi-category (e.g., "Forest has 1M+ users AND prices at $1.99/mo").'}

RESOURCES TO LOAD BEFORE STARTING:
- Load resource: resource://source-tier-bias (tier and bias reference — used to grade every fact)

ROUTING GROUPS (LLM picks based on evidence_type, or auto-routes from the claim shape):
- competitor_metric → find_closest_competitor, read_competitor_changelog, find_public_revenue_signals
- pricing → find_pricing_anchors
- demand → estimate_demand_signals, scan_producthunt_launches, find_yc_rfs_alignment
- platform → check_big_tech_encroachment, assess_platform_dependency
- why_now → find_why_now_signals
- failure_mode → get_category_failure_modes

ANTI-BIAS MECHANICS (all three MANDATORY — non-negotiable):
1. tier-grade every fact using S/A/B/C/D from the source-tier-bias resource. No DOK 1 fact may be cited without a tier badge.
2. bias-flag every source as independent / vendor-funded / conflicted / unknown. No source may appear in the supporting or contradicting table without a bias flag.
3. search for contradicting evidence BEFORE forming the verdict — this is MANDATORY, NOT optional. Issue tool calls explicitly seeking disconfirming data (e.g., reviews that say the opposite, competitor pricing that undercuts the claim, demand signals that show flat or declining interest). The verdict cannot be written until this search has happened. If no contradiction surfaces after explicit search, state the search terms used and that nothing surfaced — empty contradicting-evidence tables are acceptable ONLY when the prompt narrates "searched for X, Y, Z contradictions, none surfaced."

VERDICT RULES:
- SUPPORTED requires ≥2 tier-B-or-higher sources on the supporting side AND a documented contradicting-evidence search.
- REFUTED requires ≥1 tier-B-or-higher source on the contradicting side that directly contradicts the claim.
- INCONCLUSIVE when the supporting evidence is C/D-only, or when supporting and contradicting evidence are at parity, or when the claim cannot be tier-graded with available tools.
- Confidence is HIGH when both sides are predominantly S/A tier and independently sourced; MEDIUM when mixed tiers or some vendor-funded signal; LOW when C/D heavy, conflicted-source heavy (>30%), or evidence is thin.

WORKFLOW:
Step 1 — Commit to a routing group. State which group you are using and why (one line).
Step 2 — Call the tools in that group. Capture every fact with [tier] and [bias] inline.
Step 3 — Run an explicit contradicting-evidence search BEFORE writing the verdict. Name the search terms / counter-hypotheses you tested.
Step 4 — Render the output template below VERBATIM. Use the exact headings and table shape.
Step 5 — Write the Veto note: exactly ONE of three sentences (see template).

OUTPUT TEMPLATE (render exactly — do not paraphrase the headings):

# Assumption verdict

**Claim:** "${claim}"
**Verdict:** SUPPORTED | REFUTED | INCONCLUSIVE
**Confidence:** HIGH | MEDIUM | LOW
**Routed via:** ${routingLabel}

## Supporting evidence

| Source | Tier | Bias | Excerpt |
|---|---|---|---|
| <url or citation> | S/A/B/C/D | independent/vendor-funded/conflicted/unknown | <quoted fact> |
| ... | ... | ... | ... |

## Contradicting evidence (mandatory search)

| Source | Tier | Bias | Excerpt |
|---|---|---|---|
| <url or citation> | S/A/B/C/D | independent/vendor-funded/conflicted/unknown | <quoted fact> |
| ... | ... | ... | ... |

(If no contradicting evidence found after explicit search: state that directly. Empty contradicting-evidence section is acceptable ONLY if the prompt narrates "searched for X, Y, Z contradictions, none surfaced.")

## Reasoning

<2-4 sentences explaining how the evidence pile justifies the verdict + confidence. Names the tier mix. If verdict is INCONCLUSIVE, explicitly states what evidence is missing.>

## Veto note

<1 sentence. Either: "This claim, if true, is load-bearing for [gate]." OR: "This claim doesn't materially change a \`validate_idea\` verdict." OR: "Recommend running full \`validate_idea\` if this assumption holds.">

ANTI-PATTERN CHECKLIST (verify before emitting the verdict):
[ ] Every supporting fact carries a [tier] badge AND a [bias] flag
[ ] Every contradicting fact carries a [tier] badge AND a [bias] flag
[ ] Contradicting-evidence search ran BEFORE the verdict was written (not after)
[ ] If no contradicting evidence surfaced, the search terms used are named explicitly
[ ] Verdict label is exactly one of SUPPORTED / REFUTED / INCONCLUSIVE
[ ] Confidence label is exactly one of HIGH / MEDIUM / LOW
[ ] Veto note picks ONE of the three sentences — does not invent a fourth
[ ] No DOK 1-4 layering — this is a verdict + sources block, not a mini-report
[ ] finalize_validation_report was NOT called (this prompt renders inline)

Claim under test: "${claim}"
Evidence type: ${routingLabel}`,
            },
          },
        ],
      };
    }
  );
}
