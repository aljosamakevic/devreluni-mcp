# Tool-to-Gate Map

This document defines which tools are used at each validation gate and whether each usage is Primary (P) or secondary/supporting (s).

**Gates:**
- G1: Competitor Landscape (Is the space occupied?)
- G2: Market Demand (Is there real, measurable demand?)
- G3: Platform / Moat Risk (Can a platform or incumbent kill this?)
- G4: Willingness to Pay (Will people actually pay?)
- G5: Why Now (Is this the right moment?)

---

## Tool-Gate Matrix

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

**P** = Primary tool for this gate (always call)
**s** = Secondary / supporting tool (call if primary results are ambiguous or you need corroboration)

---

## Tool Reuse Rules

Some tools are expensive (API calls, web fetches) and should be called once per validation run, with their results referenced across multiple gates rather than re-called:

1. **find_closest_competitor** — Call once at G1. Reference the competitor list at G2 (demand), G4 (pricing anchors), and G5 (why now context) without re-calling.

2. **read_competitor_changelog** — Call once per competitor identified by `find_closest_competitor`. Store results; reference for G3 (platform moves) and G4 (pricing history) without re-fetching.

3. **get_category_failure_modes** — Call once. Results are cross-gate intelligence — reference the failure mode list at G2, G3, G4, and G5.

4. **find_pricing_anchors** — Call once. Results inform G4 primarily, but the pricing model data also informs G1 (moat assessment) and G2 (market viability).

5. **find_public_revenue_signals** — Call once. Results inform G2 (demand validation via MRR comps) and G4 (WTP calibration via public ARR data).

---

## Gate Definitions (for context)

### Gate 1: Competitor Landscape
- Are there incumbents? How many? How old?
- Is the space crowded, nascent, or abandoned (and if abandoned, why)?
- Do incumbents have structural advantages (data moats, network effects, platform lock-in)?

### Gate 2: Market Demand
- Is there real, measurable, organic demand?
- Evidence: search trends, community size, MRR comps from public indie founders, PH launch engagement.

### Gate 3: Platform / Moat Risk
- Could Google, Apple, Salesforce, or another incumbent ship this in 12 months?
- Is the product dependent on a platform that could flip rules or ship a native alternative?
- Are there distribution moats the entrant cannot replicate?

### Gate 4: Willingness to Pay (WTP)
- Does pricing data suggest this category can support the builder's economic target?
- Are there working paid products (not just free/freemium)?
- Do pricing trends show strength or deterioration?

### Gate 5: Why Now
- What changed recently that makes this idea viable today but not 2 years ago?
- YC RFS alignment, model capability step-changes, regulatory shifts, recent platform API changes.
- Is there a narrow timing window that closes (urgency) or a permanent unlock (durable)?
