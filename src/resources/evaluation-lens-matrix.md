# Evaluation Lens Matrix

This matrix defines how each gate's pass/fail thresholds flex based on the **framing** (audience × builder type). Apply this matrix when running `validate_idea` or `run_single_gate`.

**Framings:**
- B2B + solo
- B2B + small_team
- B2B + funded
- B2C + solo
- B2C + funded
- dev_tools + solo

**Gates:**
- G1: Competitor Landscape
- G2: Market Demand
- G3: Platform / Moat Risk
- G4: Willingness to Pay
- G5: Why Now

---

## Gate 1: Competitor Landscape

| Framing | Pass Evidence | Fail Evidence | Flex |
|---------|--------------|---------------|------|
| B2B + solo | 1-3 incumbents with visible churn signals; no Microsoft/Salesforce native overlap | Salesforce or HubSpot ships native version; or space has 10+ funded entrants | Structural weakness in 1 incumbent is sufficient to justify entry |
| B2B + small_team | 2-5 incumbents with identifiable segment gaps; at least 1 with credible weakness | Category leader has 80%+ market share and no visible churn | Must show a specific ICP gap the team can win |
| B2B + funded | Fragmented market OR clear category creator opportunity; incumbents have structural debt | Dominant locked-in incumbent with high switching cost and low churn | Funding means they can compete on features; needs durable differentiation |
| B2C + solo | Niche not served by top 3 consumer apps; or behavioral unlock (habit, platform) not yet exploited | Top app has 10M+ DAU and serves exact use case; or viral loop owned by competitor | Viral growth path required; distribution is the moat |
| B2C + funded | Known category with monetization gap OR proven demand in adjacent market | Saturated consumer category with well-funded leaders and strong network effects | Network effect analysis required; can funding overcome the distribution gap? |
| dev_tools + solo | Problem experienced by builder; 1-2 paid tools exist but have known friction; OSS gap | Major cloud provider (AWS/GCP/Azure/Vercel) ships native version of core feature | Dev tools benefit from distribution via OSS; GitHub stars are a signal |

---

## Gate 2: Market Demand

| Framing | Pass Evidence | Fail Evidence | Flex |
|---------|--------------|---------------|------|
| B2B + solo | 3+ indie founders in category with public MRR > $5k; or active subreddits with 10k+ members; or 100+ HN comments on the problem | No found public MRR comps; category subreddits dead or < 1k members | A single founder with $30k+ MRR in the category is strong standalone signal |
| B2B + small_team | Public MRR comps at $20k-200k range; PH launches with 200+ votes; active community | All found MRR comps < $10k; PH engagement < 100 votes across category | Small_team needs to see path to $50k+ MRR; $10k-level comps require strong differentiation story |
| B2B + funded | Proof of $1M+ ARR in category (public comps, funding announcements); TAM estimate supported by A-tier source | No funded comparable found; or all comps are lifestyle/solo businesses | Funded framing requires institutional-scale evidence; lifestyle comps don't validate VC-target markets |
| B2C + solo | 50k+ Google search volume for core problem; viral content on topic (TikTok, Twitter); active subreddit > 50k members | Search volume < 5k; no consumer community found; D2C comps all failed | B2C demand evidence is often lagging — search volume + community size together |
| B2C + funded | Search trends growing YoY; viral distribution mechanism identified; paid acquisition CPAs viable based on comparable apps | Declining search trends; high CAC without clear LTV path | Funded B2C requires both demand signal AND monetization path |
| dev_tools + solo | Specific GitHub issue/discussion with 100+ thumbs up; StackOverflow question with 50k+ views; 2+ HN "Ask HN: Is there a tool for X?" posts | No found developer community discussion; problem only mentioned in vendor marketing | Developer demand is highly legible — if developers want something they say so loudly |

---

## Gate 3: Platform / Moat Risk

| Framing | Pass Evidence | Fail Evidence | Flex |
|---------|--------------|---------------|------|
| B2B + solo | No platform dependency; or platform unlikely to move (small market, niche workflow); or viable off-platform distribution | Core feature is on incumbent's roadmap (cited in changelog); or single-platform dependency without alternatives | Solo tolerance is low — any serious platform risk is a FAIL because there's no runway to survive it |
| B2B + small_team | Platform risk exists but team has alternative distribution or integration strategy; or moat is data/workflow not feature | Feature announced at last platform keynote with shipped beta; or category defined by platform (e.g., Shopify apps) | Small team can survive platform changes if they have 6-12 months of runway and a pivot path |
| B2B + funded | Platform risk manageable with capital; funded company can build abstraction layer or acquire distribution | Core value prop is a feature of a platform API that could be deprecated; or company at mercy of one platform for 90% of revenue | Funded players must show platform independence strategy or evidence platform is a commodity input |
| B2C + solo | Consumer behavior is platform-agnostic; or product works across multiple platforms | iOS/Android policy could block core mechanic; or Apple has shipped a native version in the last 18 months | App Store/Play Store risk is existential for B2C solo — platform as distribution AND store is double dependency |
| B2C + funded | Diversified distribution channels; funding allows web-first + app; SEO or paid acquisition not platform-dependent | 90% of user acquisition goes through a single platform that has own competing product | B2C funded must show distribution independence — can't be entirely at mercy of one platform's algorithm |
| dev_tools + solo | Tool is infrastructure-agnostic OR runs where developers already are (CLI, IDE plugin, API); no platform has deployed equivalent | AWS/GCP/Azure/Vercel has shipped equivalent in last 24 months; or tool is a thin wrapper on a major platform API | dev_tools has the harshest G3 standard — platform risk is higher because major cloud providers actively commoditize developer tools |

---

## Gate 4: Willingness to Pay (WTP)

| Framing | Pass Evidence | Fail Evidence | Flex |
|---------|--------------|---------------|------|
| B2B + solo | 2+ comparable paid tools at $20-200/mo; OR public MRR comps showing paying customers exist; OR G2/Capterra reviews cite ROI | All category tools are free/freemium; no paid comp found; churned-language signals dominant in reviews | For solo, finding 1 paid tool with credible traction is sufficient if churn signals are low |
| B2B + small_team | Clear pricing ladder in category ($50-500/mo range); evidence of annual contracts or expansion revenue; low churn signal in reviews | Pricing race-to-bottom visible in changelog history; category has commoditized | Small_team needs proof of $5k+ ACV deals or equivalent monthly churn-resistant pricing |
| B2B + funded | Category has demonstrated $10k+ ACV deals; enterprise motion is viable; pricing comps support $1M+ ARR ceiling | Category tops out at $500/mo; no enterprise tier in any comparable; reviews show budget ceiling | Funded needs enterprise tier evidence; prosumer pricing comps alone are insufficient |
| B2C + solo | App Store comps show IAP or subscription revenue; category has paid apps with > 1k ratings; or paywalled freemium comps | All comps are free; or category has strong free alternatives from platform providers | B2C WTP evidence is harder — App Store revenue is opaque; use IndieHackers and public MRR as proxy |
| B2C + funded | Category has funded consumer subscription businesses; CPM/CPL/LTV data suggests positive unit economics | Category dominated by ad-supported free products; consumer WTP ceiling < $5/mo for the segment | Funded B2C WTP requires LTV analysis; acquisition cost must be recoverable in < 12 months |
| dev_tools + solo | Self-serve SaaS comps at $10-100/mo or one-time license; open-source tool with commercial tier; GitHub Sponsors showing revenue | All equivalent tools are OSS with no paid tier; or category player went free-forever recently | dev_tools WTP is nuanced — OSS with a paid tier is a strong signal; pure OSS without commercial model is a WTP concern |

---

## Gate 5: Why Now

| Framing | Pass Evidence | Fail Evidence | Flex |
|---------|--------------|---------------|------|
| B2B + solo | Recent model capability step-change enables the product; or regulatory shift opened a new obligation; or platform opened a new API in last 18 months | No identified catalyst; problem has existed for 5+ years without resolution; timing is arbitrary | YC RFS alignment counts as a strong solo "why now" — it signals the macro moment is validated by top-tier pattern recognition |
| B2B + small_team | Identifiable enabling event in last 24 months; or incumbent just raised prices/deprecated a product creating a migration window | Why now is "AI is hot" without a specific capability connection; or timing window has already closed | Must identify the specific unlock — not just "AI is now available" but "GPT-4V means X workflow is now automatable" |
| B2B + funded | Clear macro tailwind supported by A-tier data; or regulatory change with multi-year enforcement ramp; or platform API opened to third parties at scale | Why now story is marketing-speak; no A-tier source supports the timing claim | Funded + B2B has the strictest G5 — investors ask this question and need a crisp answer; vague tailwinds are insufficient |
| B2C + solo | Viral cultural moment or behavior shift creating a window (but solo can't chase viral); or platform launched enabling feature in last 6 months | Why now depends entirely on a trend that requires massive distribution to capture | B2C + solo = hardest framing for G5. Only durable behavioral unlocks (not trends) pass. |
| B2C + funded | Funded B2C can chase a trend; cultural moment is a legitimate why now IF paired with 12+ month runway; or platform shift is permanent | Trend peaked 6+ months ago; or why now story depends on the past (not the present moment) | Funded tolerance for trend-riding is higher — but only if distribution can be bought fast enough |
| dev_tools + solo | A new language/framework/platform just achieved adoption threshold; or a major API just shipped that creates tooling need; or a new workflow (LLM coding, etc.) has no tooling yet | Why now is "developers need this" without a specific ecosystem shift | dev_tools why now is usually the most legible — ecosystem shifts are public and trackable |

---

## Cross-Gate Framing Patterns

### Solo + B2C = Hardest Framing
- G2 requires organic demand (no budget for paid acquisition)
- G3 is harsh (distribution platform dependency is existential)
- G5 requires durable unlock, not trend
- Recommended strategy: validate G2 and G5 first; fail fast at G1

### Funded + B2B = Loosest Gates but Strictest Why Now
- G1 and G3 tolerate more risk (capital buys runway)
- G4 needs enterprise evidence
- G5 is hardest — investors will probe this; must have a crisp 30-second answer
- Recommended strategy: nail G5 before fundraising

### dev_tools = Unique Platform Risk Profile (Harshest G3)
- G3 is the most stringent for dev_tools because cloud providers actively commoditize
- G2 evidence is the most legible of all framings (developers are vocal)
- G4 nuanced: OSS adoption path requires separate WTP analysis for commercial tier
- Recommended strategy: verify no AWS/GCP equivalent before any other gate

### Anything + Funded = Stricter Why Now
- When builder = funded, G5 automatically applies the strictest standard
- "The market is growing" is never sufficient — must cite specific enabling event
- This applies regardless of audience type
