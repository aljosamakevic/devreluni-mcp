# ProductValidation MCP — Framework Context

> **Purpose:** This document captures the upstream advisory session and intellectual lineage of the ProductValidation MCP. The Build Spec v1.0 (in `build-spec-v1.0.md`) tells you *what* to build. This document tells you *why* — the frameworks, decisions, case studies, and founder context that produced the spec.
>
> **Audience:** Engineering agents, planning agents, code reviewers, future-Aljosa.
>
> **Source:** Reconstructed from the original ProductValidation MCP Build Context document (May 2026 PM advisory session). Captures intent that doesn't fit cleanly into the spec but informs every implementation decision.

---

## 1. The Founding Use Case

This MCP was born from a real advisory session where a product idea (AI-native focus app) was **validated and killed in 90 minutes** using research and a structured framework — faster and cheaper than the 18 months of building it would have required.

The ProductValidation MCP exists to operationalize that 90-minute process so any founder can run it before committing build time.

---

## 2. The Pre-Build Checklist (Source Framework)

This is the central framework the MCP operationalizes. Run before writing a PRD or a line of code.

**Rule: Fail any 2 of the 5 = pass on the idea.**

(See spec §3 for the 5 gates as implemented. This section captures the *thinking* behind each gate.)

### 1. Direct Competitor Scan
- Find the closest existing product
- **Read their changelog specifically** — this is the highest-signal competitive intel that exists
- Changelogs reveal what broke in the wild, what users complained about, and where the original pitch failed contact with real users
- *Example from the founding session:* Fomi's v1.1 changelog added "tell us your occupation" and "specify tools you'll use" — revealing their "no setup" pitch failed immediately

### 2. Market Structure
- Winner-take-most (network effects, data moats) vs. room for many (workflow tools, vertical SaaS)
- If winner-take-most and an incumbent exists with 12+ months head start → very high bar to clear
- Focus apps, social networks, marketplaces = winner-take-most
- B2B workflow tools, vertical SaaS, developer tools = often room for many

### 3. Big-Tech Encroachment Risk
- Could Apple / Google / Microsoft ship this as a system primitive in 24 months?
- Test: does this require OS-level access, default app status, or hardware integration to be great?
- If yes → building on a road they're paving through your house
- High-risk examples: focus/screen-time tools (Apple Intelligence), basic task management (Google Tasks), calendar AI (Google/Microsoft)

### 4. Unit Economics Sniff Test
- Price ceiling: what's the max a user would realistically pay?
- Churn pattern: is this an "ADHD tax" category (buy and abandon) or sticky workflow tool?
- CAC: is the target user reachable cheaply (developer communities, ProductHunt) or expensive (SMB, consumer)?
- **Productivity-for-individuals = one of the worst SaaS verticals**: low price ceiling, high churn, high CAC

### 5. Unfair Advantage
- Beyond "I have the problem too" (everyone does)
- Real unfair advantages: proprietary data from private workflows, existing distribution (community, audience, relationships), hard integrations that take months to negotiate, deep domain expertise built over years
- **Test:** Could a well-funded competitor replicate your advantage in 12 months? If yes, it's not structural.

---

## 3. The Natal Studio / YC Defensibility Lens

From Natal Studio's explicit thesis:

> "In the age of AI, any software product can be replicated in weeks. The model, the UI, the features — none of it is a moat anymore."

**Only two acceptable moats in 2026:**

### Moat 1: Proprietary Data
Data from private workflows that doesn't exist on the public internet. Every interaction makes the product smarter in a way competitors can't replicate. This is a flywheel: more users → more proprietary signal → smarter product → more users.

**Key question for evaluating an idea:** Does the founder have access to private workflow data that would be impossible to acquire without already having the users?

- ✅ Structural (moat): exclusive data access, prior product with data, enterprise partnership
- ❌ Feature (not a moat): building a great data model, scraping public data, using the same LLMs as everyone

### Moat 2: Distribution
A founder with existing customer relationships, community, or audience. **Capital can't buy this in a year.**

**Key question:** Is this founder text-message-friendly with 5-10 people who are the target customer? Not "I know people in this space" — specifically: would they take an unprompted text saying "I built something, can you try it?"

- ✅ Structural (moat): existing community, prior company with same customers, deep domain reputation
- ❌ Feature (not a moat): "I'll build an audience," good at content marketing, network is adjacent but not exact

### Applying this to idea evaluation:
- Does the idea generate proprietary data as a byproduct of normal usage?
- Does the founder have asymmetric distribution for this specific idea?
- **If neither → the product needs to be 10x better on one specific axis to win, not 1.5x better on three.**

---

## 4. YC Summer 2026 RFS — Categories Actively Being Funded

(Note: this dataset is what `find_yc_rfs_alignment` currently encodes statically. Update quarterly when YC publishes a new RFS.)

**High-signal categories for software/agent products:**

- **Company Brain** — structured, always-current map of how a company works, pulled from Slack/email/tickets/databases, turned into executable skills files for AI agents. Not search, not RAG, not a chatbot over docs.
- **Software for Agents** — every software category rebuilt for agents as first-class citizens. APIs, MCPs, CLIs instead of visual interfaces. Machine-readable docs. Programmatic discovery and signup.
- **AI-Native Service Companies** — sell the service, not the software. Replace outsourced functions end-to-end (accounting, compliance, insurance brokerage, healthcare admin).
- **Dynamic Software Interfaces** — users as their own forward-deployed engineers. Shared primitives, radically customized interfaces per user.
- **SaaS Challengers** — AI collapsed software dev costs 10-100x. Attack categories that seemed untouchable: ERPs, chip design tools, industrial control, supply chain.
- **AI Operating System for Companies** — connective layer making entire company legible to AI. Slack + Linear + GitHub + Notion + call recordings → single intelligence layer.

---

## 5. Competitive Analysis Methodology

How to research a competitor deeply, in the order the master prompt should follow:

### Step 1: Find the real competitor
- Don't just search "is anyone doing X"
- Search for the specific mechanic: "AI screen monitoring on-task ADHD 2026"
- **Independent convergence with a competitor's framing = your insight is real AND the space is competitive.** Both things are true simultaneously.

### Step 2: Read the changelog, not the homepage
- Homepage = marketing
- Changelog = where the original pitch met reality
- What did they add in v1.1? That's what broke in v1.0.

### Step 3: Check press coverage for the consistent criticism
- Independent reviewers who say the same thing = structural weakness, not edge case
- *Example from founding session:* 3 independent sources all flagged Fomi's cloud screenshots as primary objection → structural privacy gap

### Step 4: Check adjacent products for category-level failure modes
- Find tools that have been around long enough to have honest user reviews
- *Example:* Rize, FocusMe, Focus Bear, Opal — all in focus app category — all have same 5 complaints
- These are the failure modes of the **category**, not just one product

### Step 5: Map weaknesses to exploitable gaps
For each weakness ask:
- Is this a **feature** (incumbent can ship it) or a **structure** (would require rebuilding the product)?
- Does fixing this create asymmetric distribution or just a better product?
- What does this look like commoditized in 24 months?

---

## 6. The Fomi Case Study (Founding Session Killshot)

The original advisory session evaluated an AI-native focus app idea and killed it in 90 minutes. This case is the **calibration anchor** for the MCP — re-running this idea through `validate_idea` must produce NO-GO with the killshot reasons below (this is the spec §11 Critical Test).

**Direct competitor identified:** Fomi (launched late 2025)

**Category-level structural weaknesses surfaced:**
- **Cloud screenshots** — primary privacy gap, flagged independently by 3+ press sources
- **Desktop-only** — phone is escape valve, defeats enforcement
- **No circumvention resistance** — users disable when frustrated
- **Setup creep** — v1.1 changelog revealed "no setup" pitch failed
- **Single intervention modality** — users adapt around the restriction

**Unit economics:**
- Brutal. ~$10/mo ceiling for the category
- ADHD-tax churn pattern (60-80% annual)
- High CAC vs. willingness to pay

**Platform risk:**
- Apple Intelligence + Screen Time API = direct encroachment territory
- Adjacency 4-5 on the spec's encroachment scale

**Verdict in advisory session:** Killed in 90 minutes. Saved 12-18 months.

---

## 7. Customer Discovery Framework (Jeff Weinstein, Stripe)

Referenced in spec §9 Evaluation Lens Matrix but the actual technique isn't there. This is the source.

### Core principles
- **Don't pitch.** Don't ask if they'd use your product. Ask about their world.
- **The opening question:** "What would you be doing if you weren't talking to me right now?"
  Then sit in silence. The answer tells you what their actual workday looks like, what's urgent, what they interrupted to talk to you.
- **The burning problem test:** People don't get out of bed for their second problem. If what you're building solves their second problem, they'll never actually use it — they'll say they would, but they won't.
- **The paying test:** "Willing to pay" ≠ paying. Practice charging someone $1. The moment money is on the table, the conversation gets honest. People who won't pay $1 definitely won't pay $10/month.
- **Text-message-friendly with 5-10 target customers** = more signal than most companies have.

### Signal to listen for
- Do they have language for this problem already? (People name problems that matter to them)
- How often do they encounter it? (Once a month = not a burning problem)
- What do they do today to solve it? (Every workaround is a business waiting to be built)
- Have they paid for a solution before? (Prior purchase = validated willingness to pay)

### Anti-patterns (avoid in any discovery)
- ❌ "Would you use a product that..." → leading, always get yes
- ❌ "How much would you pay for..." → hypothetical, meaningless
- ❌ "What features would you want?" → you're the product person, not them
- ❌ "Does this resonate?" → fishing for validation
- ❌ Filling silence with your own pitch

---

## 8. MCP Tool Design Principles

From the session on why "just wrap LLM calls" isn't enough. Real value-add in agent tooling comes from one of four things:

1. **Data the LLM can't reach** — authenticated APIs, behind-login content, real-time feeds, private workflows
2. **Deterministic actions** — actually sending emails, scheduling, executing code, modifying files
3. **Persistent state** — memory across sessions, learning from outcomes, tracking over time
4. **Composability at scale** — if 100 agents need this primitive, building it once is leverage

If your tool isn't doing one of these four, you're prompt-engineering with extra steps.

### Tool naming convention (Jeff Weinstein via Lenny's podcast)

> "Pick metric titles that make you feel something."

Same applies to MCP tools. Name tools by what they do for the user, not what they technically execute.

- ❌ `run_competitor_analysis_pipeline`
- ✅ `find_who_already_built_this`

(The spec uses pragmatic names — `find_closest_competitor`, `read_competitor_changelog`. Both directions work. The principle to follow: when in doubt, name from the user's perspective.)

---

## 9. Key Operating Insights

### On idea validation
- **Independent convergence with a competitor = insight is real AND space is competitive.** Both things are true simultaneously.
- **"Good idea" is the cheap input** in entrepreneurship. Time, focus, and conviction are expensive.
- **The cost of NOT building** something is often 6-12 months of your life. Research is the cheap alternative.

### On competitive analysis
- **Changelog > homepage.** Always read the changelog first.
- When **multiple independent press sources** flag the same weakness, it's **structural, not anecdotal**.
- A startup wins by being **10x better on one dimension**, not 1.5x better on three.

### On moats
- **Features get cloned. Structures are durable.**
- Proprietary data from private workflows = structural moat. UI/model/features = cloneable in weeks.
- Distribution built through community and relationships = structural. Paid acquisition = not a moat.

### On the focus app market specifically (case study)
- Fomi = direct competitor to AI focus app idea, launched late 2025
- Category weaknesses: cloud screenshots (privacy gap), desktop-only (phone escape valve), no circumvention resistance, setup creep, single intervention modality
- Unit economics: brutal. $10/mo ceiling, ADHD-tax churn, Apple encroachment risk.
- **Correct response: killed idea in 90 minutes. Saved 12-18 months.**

---

## 10. Agent Behavior Guidelines

When running validation, the agent (LLM consuming the MCP's prompts/tools) should:

1. **Lead with the kill shot** — if there's a fatal flaw, surface it first, not buried in a balanced analysis
2. **Distinguish feature from structure** — for every claimed advantage, ask if an incumbent could ship it in 6 months
3. **Name the specific competitor** — not "there are players in this space" but "the closest product is X, launched Y, here's their changelog"
4. **Separate insight validity from opportunity validity** — an idea can have a real insight AND be too late. Both things are true.
5. **Push on unfair advantage** — "I have the problem too" is not an unfair advantage. Push until the founder names something structural.
6. **Time-box the research** — the goal is a decision in 90 minutes, not a comprehensive market study. Enough to pass/fail the checklist.

(These show up in the spec as parts of the master `validate_idea` prompt and the `steelman_against` red-team prompt.)

---

## 11. Session Origin & Founder Context

**Project:** ProductValidation MCP
**Builder:** Aljosa Makevic — engineer-turned-PM, 5+ years SaaS/Web3, based in Belgrade
**Context:** Built as the DevRel Uni Cohort 7 project
**Learning goals:** Understand MCP server architecture and multi-agent orchestration
**Domain choice rationale:** Aljosa has deep personal investment in product validation and will dogfood the tool actively — solo founder who has personally evaluated and killed multiple product ideas (most recently the AI-native focus app, in 90 minutes, using this framework).

The original advisory session also covered:
- Evaluating product ideas for the Natal Studio founder cohort application
- DevRel Uni Cohort 7 project selection (the MCP itself won this slot)

---

## 12. References & Further Reading

- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- MCP Python SDK: https://github.com/modelcontextprotocol/python-sdk
- Anthropic tool use docs: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
- MCP specification: https://modelcontextprotocol.io/docs
- Natal Studio thesis: referenced explicitly above
- Jeff Weinstein on Lenny's Podcast: customer discovery, "metric titles that make you feel"
- YC Summer 2026 Request for Startups: https://www.ycombinator.com/rfs

---

*This document is the intellectual lineage of `build-spec-v1.0.md`. Read both together when in doubt about why a design decision was made.*
