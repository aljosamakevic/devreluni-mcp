# ProductValidation MCP — Build Specification v1.0

> **Purpose:** This document is a complete specification for an MCP server that performs unbiased product idea validation. It is designed to be handed to an engineering agent (e.g., Claude Code) to implement.
>
> **Audience:** Engineering agent + Aljosa as PM reviewing.
>
> **Status:** Spec complete. All design decisions locked. Ready to build.

---

## Table of contents

1. [What we're building](#1-what-were-building)
2. [Architecture overview](#2-architecture-overview)
3. [The 5 gates](#3-the-5-gates)
4. [Source tier & bias flag system](#4-source-tier--bias-flag-system)
5. [Output artifact spec](#5-output-artifact-spec)
6. [Prompts (5 user-invoked workflows)](#6-prompts)
7. [Tools (12 total)](#7-tools)
8. [Resources (3 static reference docs)](#8-resources)
9. [Evaluation lens matrix](#9-evaluation-lens-matrix)
10. [Build sequence & v1 scope](#10-build-sequence--v1-scope)
11. [Quality bar / definition of done](#11-quality-bar--definition-of-done)
12. [Open product questions for post-v1](#12-open-product-questions-for-post-v1)

---

## 1. What we're building

A **Model Context Protocol (MCP) server** that helps solopreneurs and small builder teams validate product ideas with unbiased, source-grounded evidence — producing a GO / NO-GO / CONDITIONAL GO verdict across 5 structured gates.

**Why MCP rather than a web app:** Users are technical (will install MCP), and the MCP form factor allows the validation to live inside the user's existing AI assistant (Claude Desktop, Cursor, etc.) — meeting them where they already think and write. A frontend follows once the MCP MVP is working.

### The single defining design goal

**Make confirmation bias structurally impossible.**

Most "AI validation" tools produce plausible-sounding analysis that pattern-matches to what the user wants to hear. This one doesn't, because:

- Every fact carries both a quality tier (S/A/B/C/D) and a bias flag (independent/vendor-funded/conflicted/unknown).
- Each gate uses DOK 1→4 layering (Facts → Summary → Insights → Verdict) so interpretation is visually separated from data.
- Contradicting evidence search is a required step before any gate verdict.
- Three structured Validation Checks (Source Quality / Counterargument / Logic & Coherence) audit verdicts before they're rendered.
- The final report contains a blank "Your Spiky POV" section the user fills in — the MCP never decides for them.

If any of these mechanisms are skipped or watered down during implementation, **the MCP loses the property that makes it valuable**. These aren't nice-to-haves; they're the core IP.

### Target user

Solopreneurs and small builder teams (1-5 people) evaluating product ideas before committing build time. Secondary: funded founders pre-PRD.

### Non-goals (out of scope for v1)

- TAM calculation (intentionally cut — most-manipulated number in product; range produced only as part of Gate 2 evidence, never as a primary output)
- Full ICP / persona documents (the Niche Reachability sub-question within Gate 2 covers what's needed for validation)
- Brand archetype framing (noise for idea validation)
- GTM strategy generation (validation, not execution)
- Multi-turn step-by-step workflows (single-shot for v1)
- The Failure-Mode Library resource (grows organically from real validations post-launch)

---

## 2. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  USER (in Claude Desktop / Cursor / Claude Code)             │
│  invokes a prompt with an idea                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  PROMPTS (5 user-facing workflows)                           │
│  - validate_idea (master, full 5-gate report)                │
│  - quick_kill_check (60-second triage)                       │
│  - steelman_against (red-team mode)                          │
│  - run_single_gate (one gate deep dive)                      │
│  - generate_test_cards (hypotheses standalone)               │
└──────────────────────┬──────────────────────────────────────┘
                       │ orchestrate
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  TOOLS (12 total — fetch live signal)                        │
│  6 existing: find_closest_competitor, read_competitor_       │
│    changelog, scan_producthunt_launches, map_competitive_    │
│    weaknesses, get_category_failure_modes, find_yc_rfs_      │
│    alignment                                                 │
│  6 new: estimate_demand_signals, check_big_tech_             │
│    encroachment, find_pricing_anchors (merged WTP analyzer), │
│    find_why_now_signals, find_public_revenue_signals,        │
│    assess_platform_dependency                                │
└──────────────────────┬──────────────────────────────────────┘
                       │ reference
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  RESOURCES (3 static reference docs)                         │
│  - Source Tier & Bias Flag Definitions                       │
│  - Tool-to-Gate Map                                          │
│  - Evaluation Lens Matrix                                    │
│  Plus: this build doc itself serves as the artifact spec.    │
└──────────────────────┬──────────────────────────────────────┘
                       │ produce
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  OUTPUT ARTIFACT: Idea Validation Report                     │
│  Markdown. Pasteable into Notion. Self-contained.            │
└─────────────────────────────────────────────────────────────┘
```

### MCP primitives used

- **Prompts** — user-invoked workflows that orchestrate tools into reports
- **Tools** — live-data fetchers that return facts with source URLs
- **Resources** — static reference documents the model reads on demand

### Key technical decisions

| Decision | Choice | Rationale |
|---|---|---|
| Workflow style | Single-shot (not multi-turn) | DOK layering shows the work; user audits after the fact |
| Tool result structure | Always `{ data, source_url, source_tier, bias_flag, fetched_at, confidence_note }` | Forces source labeling at the data layer, not the prompt layer |
| Paid API dependency | Allowed with graceful degradation | Use Ahrefs / SimilarWeb when keys available; fall back to free sources (Reddit subs, GitHub stars) with lower confidence ratings |
| Tool reuse across gates | Cached, called once | `find_closest_competitor` runs in Gate 1; results referenced in Gates 2, 4 |
| Verdict authority | Validation Checks can override gate math | Major issues downgrade confidence; fundamental flaws override verdict to Inconclusive |
| Fast mode | Removed | `quick_kill_check` handles fast triage; `validate_idea` is always thorough |

---

## 3. The 5 gates

The Pre-Build Checklist. Fail-2 rule: 2+ failed gates = NO-GO.

### Gate 1: Direct Competitor Scan
Who's the closest existing thing, what have they shipped, where are they weak?

### Gate 2: Market Structure
Is the market shaped such that this idea can win a meaningful share?
- For solopreneurs: niche reachability (can you reach ~1,000 customers via concentrated channels?)
- For funded teams: plausibly $1B+ TAM

### Gate 3: Platform & Big-Tech Risk
Will a platform change or a hyperscaler shipping this as a system primitive kill it in 24 months?

### Gate 4: Willingness to Pay
Will the target customer actually pay enough to make this a business?
- Public revenue from comparables is the strongest evidence
- Auto-flag if competitor pricing has dropped >25% over 24mo (weakening market)
- Auto-flag if category is all-free / freemium-only with no profitable paid tier

### Gate 5: Why Now
What changed in the last 24mo that makes this possible/necessary NOW?
- Must be a specific articulable thesis, not "AI got better"
- Automatic Inconclusive if no non-obvious why-now exists

### Verdict math

| Gate verdicts | Overall |
|---|---|
| 0 fails, ≤1 inconclusive | **GO** |
| 1 fail OR 2+ inconclusive | **CONDITIONAL GO** |
| 2+ fails | **NO-GO** |

Validation Checks (see §6.1, Step 2) can override this:
- Major issues → downgrade overall confidence to Low
- Fundamental flaws → override verdict to "Inconclusive — re-run with better sources"

---

## 4. Source tier & bias flag system

Every DOK 1 fact must carry **both** a tier badge and a bias flag.

### Tier (quality)

| Tier | Description | Examples |
|---|---|---|
| **S** | Primary, first-party, immutable | Competitor changelogs, SEC filings, Wayback snapshots, official platform ToS, GitHub commits, live pricing pages (for price only) |
| **A** | Strong secondary, user-generated at scale | IndieHackers public revenue, Reddit subscriber counts, Product Hunt metrics, founder MRR tweets, SimilarWeb, Ahrefs |
| **B** | Aggregated user feedback (pattern-rich, individually weak) | G2/Capterra reviews (aggregate of 50+), App Store reviews (pattern), HN comment threads (themes) |
| **C** | Vendor-funded research, analyst reports | Gartner, Forrester, IDC, vendor whitepapers, "State of X" reports |
| **D** | Marketing material, anonymous opinion | Vendor landing page value claims, anonymous forum comments, single Reddit posts with no engagement |

### Bias flag (neutrality)

| Flag | Meaning |
|---|---|
| **independent** | No financial/organizational stake in conclusion |
| **vendor-funded** | Paid by category participant (Gartner reports, commissioned surveys) |
| **conflicted** | Direct stake (competitor, partner, investor, employee) — positioning evidence only |
| **unknown** | Couldn't determine — treated as `vendor-funded` until upgraded |

### Decision rules using both labels

1. PASS verdict requires ≥2 tier-B-or-higher sources
2. If >30% of deciding-tier sources are `conflicted` → downgrade gate confidence by one level
3. D-tier sources never validate; they flag concerns only
4. `unknown` = treat as `vendor-funded` for confidence math
5. A single S-tier independent source outweighs multiple C-tier vendor-funded sources
6. `conflicted` competitor sources are valid only as positioning evidence (what they CLAIM, not what is TRUE)

### Runtime requirement

Every fact entered into a DOK 1 layer must have:
```
[Fact] — Source: [URL] | Tier: [S/A/B/C/D] | Bias: [independent/vendor-funded/conflicted/unknown] | Fetched: [date]
```

If any field is missing, the fact is rejected. Default to more cautious labels when uncertain (lower tier, more biased flag).

---

## 5. Output artifact spec

The Idea Validation Report — single markdown document, pasteable into Notion / Linear / Slack.

### Section 1: Header block

```
Idea: [one-sentence idea description, as submitted by user]
Framing: audience=[B2B/B2C/B2B2C/dev_tools], builder=[solo/small_team/funded]
Generated: [ISO timestamp]
MCP version: [semver]
Total sources consulted: [n]
Source quality mix: S:[n] A:[n] B:[n] C:[n] D:[n]
Bias mix: independent:[n] vendor-funded:[n] conflicted:[n] unknown:[n]
```

### Section 2: Verdict (above the fold)

- **GO** / **NO-GO** / **CONDITIONAL GO** in bold, large
- Gate summary table (5 rows: gate name, ✅/❌/⚠️, one-line reason)
- Killshot reasons (if NO-GO): 2-3 specific findings with citations
- Overall confidence: High / Medium / Low

### Section 3: Evidence Report (one DOK-layered block per gate)

```
### Gate N: [Gate Name]

Status: [Pass/Fail/Inconclusive]
Confidence: [High/Medium/Low]

#### DOK 1 — Facts (raw, sourced)
- [Fact 1] [source link, tier badge, bias flag]
- [Fact 2] [source]

#### DOK 2 — Summary (synthesis, no interpretation)
[Plain-language paragraph restating the facts.]

#### DOK 3 — Insights (interpretation — MODEL JUDGMENT, NOT FACT) ⚠️
- [Insight 1: pattern across facts]
- [Insight 2]

#### DOK 4 — Gate Verdict
[Pass/Fail/Inconclusive] because [reasoning connecting DOK 3 to gate criteria].

#### Contradicting Evidence (mandatory field)
- [Counter-evidence with source]
- [If none found: "No contradicting evidence surfaced — treat as a gap, not confirmation."]

#### Source meta
Consulted: [n] | Tiers: S:[n] A:[n] B:[n] C:[n] | Bias: indep:[n] vendor:[n] conflicted:[n]
```

### Section 4: Validation Checks

#### Check 1: Source Quality Audit
Table with 5 rows: Authority, Recency, Citation strength, Funding & bias, Primary vs secondary. Outcome: No issues / Minor / Major / Fundamental flaws.

#### Check 2: Counterargument Search
Table with 4 rows: What critics say, Strongest arguments for NO-GO, Alternative explanations, Failed analogues. Outcome: any gate verdicts flipped.

#### Check 3: Logic & Coherence Review
Table with 4 rows: Evidence-to-claim ratio, Logical fallacies, Internal consistency, Scope creep. Outcome: confidence adjustments.

#### Validation decision matrix
- All passed → render verdict as calculated
- Minor issues → render verdict, note caveats
- Major issues → downgrade confidence to Low
- Fundamental flaws → override verdict to Inconclusive

### Section 5: What Would Change This (always present)

3-7 testable hypotheses in Strategyzer Test Card format:

```
H[n]: [Specific testable claim]
- We believe: [hypothesis]
- To verify, we will: [test method]
- We measure: [metric]
- We're right if: [success threshold]
- Linked to gate: [which gate]
- Cheapest test: [landing page, 5 interviews, fake-door, scraping — never "build the MVP"]
```

### Section 6: Your Spiky POV (user-completed, LEAVE BLANK)

```
> ⚠️ The verdict above is a model-generated recommendation. The decision is yours.

My take: [user fills in]
What I disagree with in the report: [user fills in]
What I'm going to do: [user fills in]
```

### Section 7: Source Appendix

Numbered list of every source: URL, tier, bias flag, date fetched, contribution, which gate(s) and DOK layer(s) informed.

### Section 8: Methodology Notes (footer)

- Tools fired (with arguments)
- Tools that failed or returned no results
- Source tier & bias definitions reminder
- Validation rules in force
- Disclaimer: "This is a decision aid, not a verdict — final call is yours"

---

## 6. Prompts

5 user-invoked workflows.

### 6.1 `validate_idea` (master workflow)

**Arguments:**
- `idea` (required, string): one-paragraph description
- `audience` (optional): B2B / B2C / B2B2C / dev_tools — if omitted, MCP asks
- `builder` (optional): solo / small_team / funded — if omitted, MCP asks

If `audience` and `builder` are missing, MCP asks for both in one message before proceeding. Target outcome is derived from `builder`:
- solo → lifestyle ($5k-$50k MRR)
- small_team → lifestyle-to-growth ($50k-$500k MRR)
- funded → VC-scale ($10M+ ARR)

**Workflow (the model executes these steps in order):**

```
You are running a structured product idea validation using the Pre-Build Checklist framework.

Your job is to produce a verdict (GO / NO-GO / CONDITIONAL GO) backed by DOK-layered, sourced evidence across 5 gates, then audit your own verdict through three structured validation checks.

User: a {{builder}} building for {{audience}}. Target: {{derived_target}}.
Idea: {{idea}}

OPERATING RULES (non-negotiable):
1. EVERY DOK 1 fact must carry TWO labels: tier badge [S/A/B/C/D] AND bias flag [independent/vendor-funded/conflicted/unknown]
2. DOK layers must be strictly separated. Facts = objective data. Summaries = plain restatement. Insights = explicitly labeled interpretation. Verdicts = judgment.
3. For each gate, search for CONTRADICTING evidence before issuing DOK 4. If none, explicitly write: "No contradicting evidence surfaced — treat as a gap, not confirmation."
4. PASS requires ≥2 tier-B-or-higher sources. C/D-only = automatic Inconclusive. If >30% of deciding-tier sources are conflicted, downgrade confidence by one level.
5. Apply fail-2 rule: 2+ fails = NO-GO. 1 fail or 2+ inconclusive = CONDITIONAL GO. 0 fails and ≤1 inconclusive = GO.
6. Output format MUST match the Idea Validation Report artifact spec.
7. If a tool call fails or returns nothing, log it in Methodology Notes. Never fabricate.
8. Adapt evaluation criteria per framing using the Evaluation Lens Matrix resource.

WORKFLOW:

Step 0 — Framing confirmation: restate framing in one sentence. If user confirms or stays silent, proceed.

Step 1 — Run gates 1-5 in order, producing DOK-layered blocks:
  a. Identify relevant tools from Tool-to-Gate Map
  b. Call tools. Capture facts as DOK 1 entries (tier + bias flag)
  c. Write DOK 2 summary (plain language, no interpretation)
  d. Write DOK 3 insights (LABELED as model judgment ⚠️)
  e. Search for contradicting evidence (separate tool calls if needed). Add to Contradicting Evidence block.
  f. Write DOK 4 gate verdict
  g. Do NOT issue DOK 4 until step (e) is done

Step 2 — Three Validation Checks (auditing your own gate verdicts):
  Check 1: Source Quality Audit (Authority/Recency/Citation/Bias/Primary vs Secondary)
  Check 2: Counterargument Search (Critics/NO-GO case/Alternatives/Failed analogues)
  Check 3: Logic & Coherence Review (Evidence-claim ratio/Fallacies/Consistency/Scope creep)
  Each outputs: No issues / Minor / Major / Fundamental flaws

Step 3 — Apply validation decision matrix:
  All passed → render verdict as calculated
  Minor → render with confidence caveats
  Major → downgrade overall confidence to Low
  Fundamental → override to Inconclusive

Step 4 — Apply fail-2 rule to (possibly adjusted) gate verdicts. Show math in Methodology Notes.

Step 5 — Generate "What Would Change This": 3-7 hypotheses, Strategyzer Test Card format, cheapest test only.

Step 6 — Add "Your Spiky POV" section. LEAVE IT BLANK. User completes their own DOK 4.

Step 7 — Assemble full artifact per spec. Verdict above the fold. Markdown.

ANTI-PATTERN CHECKLIST (before output):
[ ] Every DOK 1 fact has both tier badge AND bias flag
[ ] DOK 3 insights are visibly labeled as model judgment
[ ] Every gate has contradicting evidence (or explicit "none found")
[ ] No D-tier source used to validate (only flag concerns)
[ ] All 3 validation checks completed with explicit outcomes
[ ] If >30% deciding-tier sources are conflicted, confidence was downgraded
[ ] Hypotheses propose cheap tests, not "build it and see"
[ ] Killshot reasons (NO-GO) cite specific DOK 1 facts, not DOK 3 vibes
[ ] Methodology Notes lists tools fired AND tools that failed
[ ] "Your Spiky POV" present but BLANK
```

### 6.2 `steelman_against` (red-team mode)

**Arguments:** `idea` (required), `claimed_strengths` (optional)

**Purpose:** Surface ONLY disconfirming evidence. Used post-GO as sanity check or by emotionally-attached users.

```
You are running a red-team analysis. Surface ONLY evidence arguing against this idea.

Skip the 5-gate structure. Use the failure-mode lens.
Call: get_category_failure_modes, map_competitive_weaknesses, check_big_tech_encroachment, assess_platform_dependency.

For each piece of evidence: state the finding (DOK 1), source, tier, bias flag, and which gate it would damage in a full validation.

Output: list of disconfirming findings → one DOK 3 prosecution paragraph → strongest single kill reason.

If user provided claimed_strengths, address each one with counter-evidence.

End with: "Strongest single reason to walk away from this idea" — one paragraph.

Do not balance the view. Do not soften. The prosecution's case, uncut.
```

### 6.3 `run_single_gate` (deep dive)

**Arguments:** `idea`, `gate` (one of: competitor / market / platform / wtp / why_now), framing args

```
Run only Gate {{gate}} on this idea: {{idea}}.

Same operating rules as master: DOK layering, source tier + bias flag, contradicting evidence required, ≥2 tier-B sources for PASS.

Produce only the gate block per artifact spec + a short "What this means for the overall idea" paragraph.

Do NOT run the three Validation Checks (master-workflow only — single-gate output is too thin to audit meaningfully).
```

### 6.4 `generate_test_cards` (hypothesis generation)

**Arguments:** `idea`, `prior_report` (optional), `risk_focus` (optional: desirability/viability/feasibility)

```
Generate 3-7 testable hypotheses for this idea, in Strategyzer Test Card format.

If prior_report provided: tie hypotheses to lowest-confidence or failed gates.
If not: identify 3 riskiest assumptions (demand / WTP / distribution).

If risk_focus set, weight toward that risk type.

Each: We believe / To verify / We measure / We're right if / Cheapest test.
Cheapest test = sub-MVP (landing page, fake-door, 5 interviews, scraping, concierge service). NEVER "build it and see."
```

### 6.5 `quick_kill_check` (60-second triage)

**Arguments:** `idea`, framing args

**Tools used (max 4):** `find_closest_competitor`, `read_competitor_changelog` (top result only), `check_big_tech_encroachment`, `find_pricing_anchors` (top 2 results)

```
Fast kill-check. Identify the ONE strongest reason this idea would fail, if such reason exists with strong (S/A tier) evidence.

Look for:
- Incumbent with 12+ months head start AND growing traction
- FAANG in the space or shipping in next 12mo
- Pricing pattern shows category can't sustain user's economic target
- "Killed by platform" pattern from competitor changelogs

Skip DOK layering. Keep tier + bias flag on facts.

If any present with high-confidence evidence: return SUSPECTED NO-GO + the one reason + citation + recommend either walking away OR running full validate_idea.

If none: return "No obvious kill found — full validation recommended."

NEVER issue a GO from this prompt. Clean quick_kill = "no obvious red flag in shallow check," NOT validation.
```

---

## 7. Tools

12 tools total. Every tool returns:
```
{
  data: <tool-specific structured payload>,
  sources: [
    {
      url: string,
      tier: "S" | "A" | "B" | "C" | "D",
      bias: "independent" | "vendor-funded" | "conflicted" | "unknown",
      fetched_at: ISO timestamp,
      contribution: string  // one-line summary
    }
  ],
  confidence_note: string,  // any caveats about completeness, fallbacks used
  fallbacks_used: string[]  // list of paid APIs that fell back to free sources
}
```

If a paid API key isn't configured, tool falls back to free sources and lowers confidence rating in `confidence_note`. Never fail silently.

### Existing tools (6) — already implemented, reused

**`find_closest_competitor`** (G1 primary, G2/G4 secondary)
Returns top 3 direct competitors with positioning summaries.

**`read_competitor_changelog`** (G1 primary, G3/G4 secondary)
Reads a competitor's changelog. Surfaces deprecated features (failure signals), walk-backs, recent feature velocity.

**`scan_producthunt_launches`** (G1/G2/G5 secondary)
Recent launches in category with upvote/comment metrics.

**`map_competitive_weaknesses`** (G1 primary, G2/G4 secondary)
Synthesizes Reddit + HN + reviews into structured complaint patterns.

**`get_category_failure_modes`** (used across all 5 gates as secondary)
Returns known failure patterns for the category.

**`find_yc_rfs_alignment`** (G5 primary)
Maps idea to YC's current Request for Startups.

### New tools to build (6)

#### P0 (must ship for v1):

**`estimate_demand_signals`** (G2 primary)
- *Input:* category keywords, idea description
- *Output:* Google Trends curve (12-24mo), top relevant subreddit sizes + posting activity, GitHub stars + commit recency for category repos, SimilarWeb traffic on top 3 competitors (if Ahrefs/SimilarWeb keys present; else fall back to free signals)
- *Source tiers used:* S (GitHub, SimilarWeb), A (Trends, Reddit data)

**`check_big_tech_encroachment`** (G3 primary, G5 secondary)
- *Input:* idea description, category
- *Output:* relevant WWDC/Google I/O/MS Build sessions (24mo), new platform APIs in space, FAANG acquisitions in category, adjacency score (1-5)
- *Source tiers used:* S (dev docs, keynotes), A (acquisition news)

**`find_pricing_anchors`** (G4 primary — merged WTP analyzer)
- *Input:* category, competitor list
- *Output:* current pricing for all direct + adjacent competitors, Wayback snapshots showing pricing history, freemium-vs-paid distribution in category, App/Play Store 1-2★ reviews filtered for cancel/refund/waste themes, G2/Capterra churn themes
- *Auto-flags:* price drops over time (weak market), all-free category (WTP concern)
- *Source tiers used:* S (live pricing, Wayback), B (review aggregates)

**`find_why_now_signals`** (G5 primary)
- *Input:* idea description, category
- *Output:* new enablers in last 24mo (APIs, model capabilities, regulatory shifts), recent YC RFS additions touching category, macro Google Trends shifts in supply-side terms
- *Source tiers used:* S (dev docs, regulatory), A (Trends, RFS)

#### P1 (ship after P0 for stronger evidence):

**`find_public_revenue_signals`** (G2 primary, G4 primary)
- *Input:* category, competitor list
- *Output:* IndieHackers public revenue entries, founder MRR tweets, SEC filings if applicable, OpenStartup pages
- *Source tiers used:* S (SEC, OpenStartup), A (IndieHackers, tweets)

**`assess_platform_dependency`** (G3 primary)
- *Input:* idea description (extract platform requirements automatically)
- *Output:* each platform the product depends on (Twitter API, Shopify, App Store, Chrome Web Store, OpenAI, etc.), recent ToS changes affecting similar products, deplatforming retros from founders
- *Source tiers used:* S (official ToS), A (founder retros)

### Tool-to-gate map (compressed)

| Tool | G1 | G2 | G3 | G4 | G5 |
|---|:-:|:-:|:-:|:-:|:-:|
| find_closest_competitor | P | s | | | |
| read_competitor_changelog | P | | s | s | |
| scan_producthunt_launches | s | s | | | s |
| map_competitive_weaknesses | P | s | | s | |
| get_category_failure_modes | s | s | s | s | s |
| find_yc_rfs_alignment | | s | | | P |
| estimate_demand_signals | | P | | | s |
| check_big_tech_encroachment | | | P | | s |
| find_pricing_anchors | s | | | P | |
| find_why_now_signals | | | | | P |
| find_public_revenue_signals | s | P | | P | |
| assess_platform_dependency | | | P | | |

P = primary (must call), s = secondary (may call if signal weak)

### Tool reuse rule

Tools serving multiple gates are called ONCE and results referenced across gates:
- `find_closest_competitor` — called in G1, results referenced in G2, G4
- `read_competitor_changelog` — called in G1, referenced in G3, G4
- `get_category_failure_modes` — called once early, referenced across all 5 gates
- `find_public_revenue_signals` — called in G2, referenced in G4
- `check_big_tech_encroachment` — called in G3, referenced in G5

Methodology Notes lists each tool call once with which gates it informed.

---

## 8. Resources

3 static reference documents the model reads on demand.

### 8.1 Source Tier & Bias Flag Definitions
Full content in §4 of this doc. Implementation: load as a single markdown resource.

### 8.2 Tool-to-Gate Map
Full content in §7 of this doc. Implementation: load as a single markdown resource.

### 8.3 Evaluation Lens Matrix
Full content in §9 of this doc. Largest resource — covers 6 framing combos × 5 gates.

**Not building for v1:** Failure-Mode Library (grows organically from real validations post-launch).

---

## 9. Evaluation lens matrix

Framing-conditional evaluation guidance per gate. Read by the master prompt when running each gate.

### Framing combos covered

1. **B2B + solo** — bootstrapped B2B SaaS
2. **B2B + small_team** — early-stage B2B with co-founder(s)
3. **B2B + funded** — VC-backed B2B SaaS
4. **B2C + solo** — bootstrapped consumer product
5. **B2C + funded** — VC-backed consumer product
6. **dev_tools + solo** — bootstrapped developer tool

**Use closest-match + judgment for:** B2B2C, dev_tools + funded, B2C + small_team

### Gate 1: Direct Competitor Scan — what flexes per framing

**Good evidence (Pass-worthy):** 1-3 competitors with weaknesses, slowing competitor velocity, positioning gap, fragmentation signals.

**Bad evidence (Fail-worthy):** Dominant competitor (80%+ mindshare) shipping aggressively, YC-funded competitor in same wedge, multiple recent deaths with same failure mode.

| Framing | What flexes |
|---|---|
| B2B + solo | Lower "good" bar — one dominant player can be beaten in a niche. Indie comparables matter more than enterprise. Specific failure mode: don't fight distribution head-on. |
| B2B + small_team | Slightly higher bar. Funded competitors more threatening. Look for "vendor consolidation fatigue." |
| B2B + funded | Tightest bar. Needs path to category leadership, not just niche. Dominant funded competitor → likely Fail unless contrarian thesis. |
| B2C + solo | Status quo is often the competitor ("how people do this without a product"). Apps with millions of downloads but 2-3★ = opportunity. Free funded alternatives = brutal WTP cross-check. |
| B2C + funded | Network effects matter. Apply "10x better" test strictly. Incremental improvements don't take consumer share. |
| dev_tools + solo | Open-source competitors in scope (GitHub stars + commit recency = market share). Free OSS dominant alternative kills SaaS variants unless SaaS adds genuine value. Look for "tool fatigue" in HN comments — wedges live there. |

### Gate 2: Market Structure — what flexes per framing

**Good evidence:** Subreddit 10k+ subs (B2B) or 100k+ (B2C), comparables on IndieHackers with $5k+ MRR, flat/up Google Trends 24mo, active PH launches.

**Bad evidence:** No profitable comparable visible, declining Trends, ghost-town community, "feature not product," demand but no revenue.

| Framing | What flexes |
|---|---|
| B2B + solo | Niche reachability, not market share. Pass bar: 5,000-buyer segment reachable via concentrated channels. Fragmentation = good. |
| B2B + small_team | Larger segment needed (20k+). Multi-channel distribution needed. |
| B2B + funded | Plausible $1B+ TAM. Winner-take-most dynamics now friendly. "Category-defining or following?" |
| B2C + solo | Network effects against you in saturated categories. Look for underserved demographic. Check: does category actually pay or expect free? |
| B2C + funded | Needs $100M+ category leader visible. Network effects required for defensibility. "Long-tail consumer" = terrible VC bet. |
| dev_tools + solo | GitHub stars = primary demand signal. Leaders with 10k+ stars + active commits + paid hosted version = real money in category. Failure mode: pure-OSS category with no monetization model. |

### Gate 3: Platform & Big-Tech Risk — what flexes per framing

**Good evidence:** No platform >50% dependency, adjacency 1-2, multi-channel distribution, category has survived 5+ years without OS absorption.

**Bad evidence:** Adjacency 4-5, single-API dependency on restrictive platform, recent ToS deaths in category, FAANG dev docs suggesting native equivalents.

| Framing | What flexes |
|---|---|
| B2B + solo | Platform ToS changes are dominant risk. Check platform's history of deprecating integration categories. |
| B2B + small_team | More capacity to absorb platform changes. Multi-platform support feasible. |
| B2B + funded | Acquisition risk reframed as opportunity. Single platform >50% revenue = VC red flag at later stages. |
| B2C + solo | App Store policies dominate. Apple "system feature" pattern: Spotlight killed launchers, Notes killed many note apps. Cross-check category history. Twitter/X, IG API restrictions = high risk. |
| B2C + funded | Same App Store risk but more partnership capacity. Network effects can outrun encroachment. Test: "even if hyperscaler shipped free version tomorrow, do users stay?" If no, Fail. |
| dev_tools + solo | Highest-risk gate for this framing. Dev tools absorbed into platforms more than any other category. Adjacency threshold lowered (2+ triggers concern instead of 3+). Check: will OpenAI/GitHub/major cloud ship this as built-in feature in 12mo? |

### Gate 4: Willingness to Pay — what flexes per framing

**Good evidence:** 3+ IndieHackers comparables at $10k+ MRR, stable/rising prices on Wayback, no pricing complaints in reviews, clear category pricing anchor, buyer has budget authority.

**Bad evidence:** Category dominated by free/freemium, competitor prices dropping >25% over 24mo, churn signals in reviews, all comparables venture-subsidized, buyer-payer mismatch.

| Framing | What flexes |
|---|---|
| B2B + solo | ≥1 IndieHackers comparable at $10k+ MRR. Price ceiling: $100-$500/mo self-serve, $500-$2k/mo sales-touched. Buyer has budget authority without procurement. Failure mode: consumer-priced product targeting B2B (worst of both). |
| B2B + small_team | ACVs $1k-$10k self-serve, up to $25k with sales motion. |
| B2B + funded | ACVs $25k+ SMB, $100k+ mid-market, $500k+ enterprise. Multi-year contracts positive. NDR >110% great signal. |
| B2C + solo | Hardest framing. Pass bar: category supports $10-$30/mo with <10%/mo churn. Failure mode: category averages <$5/mo + >50%/yr churn → labor-of-love. Consider one-time / annual-only models. |
| B2C + funded | Less harsh on per-user economics if scale. Pass bar: $100M+ ARR player visible in category. Acceptable: $20+/mo low-churn subscription, $5+ CPM ads, whales-driven IAP. LTV/CAC >3:1 at leaders. |
| dev_tools + solo | Devs price-resistant for personal tools, employers pay heavy for teams. ≥1 paid comparable visible. Failure: "tool for individuals, free alternatives exist" usually Fail unless 10x productivity edge. Better path: free individual, paid team ($10/seat/mo, 5+ seat min). |

### Gate 5: Why Now — what flexes per framing

**Good evidence:** Specific articulable thesis tied to recent enabler (new API/model capability/regulation/price drop/behavior change), YC RFS mentions category, cluster of launches.

**Bad evidence:** Vague "AI got better," "no one's built it yet" (market rejected it before), category attempted multiple times without difference, supply-side why-now with no demand-side change.

| Framing | What flexes |
|---|---|
| B2B + solo | Why-now still required even for niches. Positive: regulatory/operational change forcing new spend. Check: did THIS buyer's workflow recently change to create new pain? |
| B2B + small_team / funded | VCs evaluate why-now harder than any other dimension. Thesis must be defensible against "why didn't incumbent ship this 2 years ago?" Look for new analyst categories, conference tracks, role titles. |
| B2C + solo | Cultural/behavioral why-now > technical why-now. Examples: post-pandemic remote, social platform fragmentation, generational spending shifts. Failure: "people will start caring about X" without evidence they're starting now. |
| B2C + funded | Why-now must support category-scale shift. Network effect categories: is there a moment for new network to form? |
| dev_tools + solo | Best patterns: new API/runtime/protocol creates tooling need (e.g., MCP launch → MCP tooling). Long-context models enable codebase-wide tools. Check: is the enabler stable enough to build on, or still beta? |

### Cross-gate framing patterns

- **Solo + B2C** is the hardest framing across all gates. Expect more NO-GO / CONDITIONAL GO verdicts.
- **Funded + B2B** has loosest gates but strictest Why Now.
- **dev_tools** across all builders has unique Platform Risk profile — harsher Gate 3.
- **Anything + funded** triggers stricter Why Now.

---

## 10. Build sequence & v1 scope

### Phase 1: Skeleton (week 1)
- MCP server scaffolding
- 3 resources loaded as markdown files
- 5 prompt templates wired up (but tools may not work yet)
- Validate that prompts can read resources and produce report skeletons with placeholder data

### Phase 2: P0 tools (weeks 2-3)
Build in this order (smallest scope first, biggest unlock per build hour):

1. **`find_pricing_anchors`** — first because: smallest scope (one core API: scraping competitor pricing pages + Wayback), highest signal-per-build-time, anchors Gate 4 (the gate where most ideas die). Use this to forge the standard `{ data, sources, confidence_note, fallbacks_used }` shape.
2. **`check_big_tech_encroachment`** — second because: Gate 3 is currently uncovered; this is the simplest of the remaining tools.
3. **`find_why_now_signals`** — third: closes Gate 5 coverage.
4. **`estimate_demand_signals`** — fourth: heaviest tool (multiple API integrations); leave for last in P0 because by now the patterns are set.

After Phase 2: v1 can produce a real verdict on all 5 gates.

### Phase 3: P1 tools (week 4)
5. **`find_public_revenue_signals`** — strengthens Gate 2 and Gate 4 evidence
6. **`assess_platform_dependency`** — strengthens Gate 3 evidence

After Phase 3: v1 is production-ready.

### Phase 4: Testing & calibration (week 5)
- **Critical test:** Re-run Aljosa's AI-native focus app idea through the MCP. Expected output: NO-GO with specific killshot reasons. If GO, there's a bug.
- Run 3-5 other historical ideas where the outcome is known.
- Calibrate confidence ratings based on observed reliability.

---

## 11. Quality bar / definition of done

### v1 ships when:

- [ ] All 5 prompts callable from Claude Desktop / Cursor / Claude Code
- [ ] All 6 P0 + P1 tools return data in standard shape with tier + bias flag
- [ ] Paid API fallback works gracefully (drops to free sources + lowers confidence)
- [ ] `validate_idea` on the AI-native focus app idea returns NO-GO with sound reasoning
- [ ] `validate_idea` on a known-good idea returns GO with sound reasoning
- [ ] Output artifact renders cleanly when pasted into Notion
- [ ] All 3 resources are accessible via MCP resource protocol
- [ ] Tool call budget stays under 20 tool calls per `validate_idea` run (cost ceiling)

### What "sound reasoning" means

Every claim in the output that contributed to a Pass/Fail must have:
1. A source URL that actually exists and contains the claimed information
2. A tier badge consistent with the source type
3. A bias flag consistent with the source's funding/affiliation

The auditing test: hand the report to an outside reader and ask "is the verdict defensible from the cited evidence?" If they say no, the implementation has a bug, not the framework.

### Anti-patterns to actively reject during implementation

- ❌ Producing reports without DOK layer separation (mixing facts and interpretation)
- ❌ Soft-failing tool calls (returning made-up data when the API fails)
- ❌ Skipping Contradicting Evidence search to save tool calls
- ❌ Filling in "Your Spiky POV" section automatically
- ❌ Rendering GO verdicts when validation checks have major issues
- ❌ Defaulting `unknown` bias flag to "independent" (must default to "vendor-funded")

---

## 12. Open product questions for post-v1

These don't block v1 but should be revisited after real usage:

1. **Failure-Mode Library** — start collecting category-level failure patterns from real validation runs. After 50+ validations, this becomes a static resource.
2. **Multi-turn workflow** — if users ask for it ("I want to pause after each gate"), add it as a v2 option to `validate_idea`.
3. **Frontend** — after the MCP is stable, build a web app on top. Artifact format is already designed for it (clean markdown, expandable DOK sections).
4. **Sharing / templating** — should users be able to save validations and share with co-founders? Probably yes, but data model considerations apply.
5. **B2B2C / dev_tools + funded / B2C + small_team explicit framings** — added to Evaluation Lens Matrix if usage patterns warrant.
6. **Confidence calibration over time** — track how often GO verdicts result in successful builds, how often NO-GO verdicts were vindicated. Iterate on the verdict math.

---

## Appendix A: Example tool I/O

### Example: `find_pricing_anchors`

**Input:**
```json
{
  "category": "AI-powered focus / productivity app for individuals",
  "competitors": ["Forest", "Freedom", "Cold Turkey", "RescueTime"],
  "framing": { "audience": "B2C", "builder": "solo" }
}
```

**Output:**
```json
{
  "data": {
    "current_pricing": [
      { "competitor": "Forest", "model": "one-time", "price": "$3.99", "tiers": ["one-time premium"] },
      { "competitor": "Freedom", "model": "subscription", "price": "$8.99/mo or $39.96/yr", "tiers": ["monthly", "annual", "lifetime $129"] },
      { "competitor": "Cold Turkey", "model": "one-time", "price": "$39", "tiers": ["pro license"] },
      { "competitor": "RescueTime", "model": "subscription", "price": "$12/mo", "tiers": ["premium"] }
    ],
    "pricing_history": [
      { "competitor": "Freedom", "trend": "stable over 24mo, slight increase from $6.99 to $8.99 in 2024" },
      { "competitor": "RescueTime", "trend": "stable around $12/mo for 36mo" }
    ],
    "category_pricing_pattern": "Mixed model. Mature category. Annual subscriptions $40-150 range. One-time models still viable.",
    "freemium_distribution": "Most competitors offer free tier with limits. Premium conversion typically 2-5% based on aggregate review patterns.",
    "churn_signals": [
      "Forest reviews show low churn (one-time purchase eliminates monthly cancellation friction).",
      "Freedom reviews show ~15% complaints about subscription value after 3 months.",
      "RescueTime reviews show common 'forgot I was subscribed' cancellation pattern."
    ],
    "auto_flags": [
      "Stable pricing 24mo: positive WTP signal",
      "Premium conversion 2-5%: low but typical for B2C productivity"
    ]
  },
  "sources": [
    { "url": "https://www.forestapp.cc/pricing", "tier": "S", "bias": "conflicted", "fetched_at": "2026-05-19T14:30:00Z", "contribution": "Forest current pricing" },
    { "url": "https://freedom.to/pricing", "tier": "S", "bias": "conflicted", "fetched_at": "2026-05-19T14:30:00Z", "contribution": "Freedom current pricing" },
    { "url": "https://web.archive.org/web/2024*/freedom.to/pricing", "tier": "S", "bias": "independent", "fetched_at": "2026-05-19T14:31:00Z", "contribution": "Freedom pricing history via Wayback" },
    { "url": "https://www.g2.com/products/freedom/reviews", "tier": "B", "bias": "independent", "fetched_at": "2026-05-19T14:32:00Z", "contribution": "Freedom churn complaint themes (aggregated from 200+ reviews)" }
  ],
  "confidence_note": "Pricing data is high-confidence (live + Wayback). Churn signals are pattern-based from aggregated reviews, not individual citations.",
  "fallbacks_used": []
}
```

---

## Appendix B: Critical implementation notes for the engineering agent

1. **Resources must be loaded fresh per invocation** of the master prompt, not cached at server startup. The model needs to re-read them to ground its work. Cache is fine for tool results within a single workflow run.

2. **Tool calls should be batchable** where possible (e.g., reading 3 competitor changelogs can parallelize), but the master prompt's workflow is sequential per gate. Don't aggressively parallelize across gates — the workflow depends on gate-by-gate state.

3. **Tier and bias flag must be assigned at tool layer, not prompt layer.** The prompt cannot fabricate or override these. Tools return data with labels; prompts reason about labeled data.

4. **The "Your Spiky POV" section is deliberately left blank by the model.** This is not a bug. The prompt explicitly instructs this. Implementation should not "helpfully" fill it in.

5. **Verdict math is mechanical, then can be overridden.** Step 4 of master workflow runs the fail-2 math. Step 3's Validation Checks can then override. Order matters — don't shortcut.

6. **Confidence ratings are conservative.** When in doubt, downgrade. False-low confidence is much less harmful than false-high confidence given the use case (someone deciding whether to spend 6 weekends building).

---

*End of build specification v1.0.*
