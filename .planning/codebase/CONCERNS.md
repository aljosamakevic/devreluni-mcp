# Codebase Concerns

**Analysis Date:** 2026-05-20
**Spec audited against:** `.planning/spec/build-spec-v1.0.md` (v1.0)

Severity-ordered. Each item maps to a spec section. Honest read — do not soften.

---

## 🔴 HIGH — fundamentals at risk

These concerns threaten the "single defining design goal" (§1): *making confirmation bias structurally impossible*. If any of the 5 anti-bias mechanisms is only described in prompt text but not enforced in code, the MCP is functionally a plausible-sounding wrapper around an LLM, which is exactly what the spec says it must NOT be.

### H1. DOK layering is instruction-only — no code enforcement
**What:** The five anti-bias mechanisms (§1) include "DOK 1→4 layering" and "Contradicting Evidence search is a *required step*". In code, both exist only as instructions to the LLM inside `src/prompts/validate-idea.ts` (lines 33–46, 56–65, 159–164). There is no validator that rejects a model output missing DOK 2/3/4 separation or missing the Contradicting Evidence block.
**Why:** §1 warns: "If any of these mechanisms are skipped or watered down during implementation, the MCP loses the property that makes it valuable." A prompt-only safeguard is a watered-down implementation — the LLM can and will skip steps under load, and nothing in the server detects it.
**Where:** `src/prompts/validate-idea.ts:33-46`, `:56-65`, `:159-164`, `:185-195` (anti-pattern checklist is also LLM-side).
**Severity:** HIGH
**Fix:** Add a post-generation validator prompt or a structured-output schema (e.g., zod schema for the report sections) that fails closed if a gate block is missing DOK 1/2/3/4 + Contradicting Evidence. At minimum, ship a `validate_report` tool the prompt is forced to call before emitting the final artifact.

### H2. "Your Spiky POV" blank-section guarantee is also instruction-only
**What:** §1 lists the blank "Your Spiky POV" as one of the 5 anti-bias mechanisms; §11 lists "Filling in Your Spiky POV section automatically" as an anti-pattern to reject. Enforcement lives only in prompt text (`src/prompts/validate-idea.ts:119-121`, `:171-172`, `:195`).
**Why:** Same as H1 — a sufficiently confident model will helpfully populate that section, killing the user's required DOK 4. Code cannot currently detect or strip a populated POV block.
**Where:** `src/prompts/validate-idea.ts:119-121`, `:171-172`.
**Severity:** HIGH
**Fix:** Post-process the artifact to assert the "Your Spiky POV" block matches the empty template; refuse to render otherwise.

### H3. `unknown` bias flag default not codified — only mentioned in markdown
**What:** §4 rule 4 and §11 anti-pattern 6: *"Defaulting `unknown` bias flag to 'independent' (must default to 'vendor-funded')."* The rule is documented in `src/resources/source-tier-bias.md` but is never enforced in any tool. Tools either hardcode `'independent'`, `'conflicted'`, `'vendor-funded'` (e.g. `find-pricing-anchors.ts:155`, `check-big-tech-encroachment.ts:172, 245`), or leave bias decisions to the LLM. There is no helper like `resolveBias(flag)` that converts `unknown → vendor-funded` for confidence math.
**Why:** §11 explicitly calls this out as anti-pattern 6. §4 rule 4: *"`unknown` = treat as `vendor-funded` for confidence math."* Without a code-level helper, the LLM will silently treat `unknown` sources as neutral, inflating PASS verdicts.
**Where:** `src/types.ts` defines the union; no consumer enforces the substitution. Search `src/` — no occurrence of `unknown` being remapped.
**Severity:** HIGH
**Fix:** Add a `src/lib/bias.ts` with `effectiveBias(flag)` and `requiresUpgradeFromUnknown(sources)`; use it wherever confidence math touches sources. Document in `validate_idea` prompt that the LLM must call it (or have the report validator do it).

### H4. PASS-requires-≥2-tier-B rule (§4 rule 1) not enforced in code
**What:** Tools return sources with tiers, but no code aggregates per-gate and rejects PASS verdicts with <2 tier-B-or-higher independent sources. Rule lives only in `validate-idea.ts:41` as a prompt instruction.
**Why:** §11 definition-of-done item: "validate_idea on the AI-native focus app idea returns NO-GO with sound reasoning". Without enforcement, the LLM can claim PASS on a single C-tier source.
**Where:** No file. The rule exists as English in the prompt and resource markdown only.
**Severity:** HIGH
**Fix:** Same as H1 — a report validator that counts sources per gate and downgrades verdicts mechanically.

### H5. Validation Checks decision matrix (§3 / §11 anti-pattern 5) not enforced
**What:** §11 anti-pattern 5: "Rendering GO verdicts when validation checks have major issues." The override rule (Major → Low confidence; Fundamental → Inconclusive) lives in `validate-idea.ts:95-99` as instruction. No code applies it.
**Why:** §2 key technical decisions: "Verdict authority — Validation Checks can override gate math". This is supposed to be mechanical — the spec uses the word "override," not "suggest."
**Where:** `src/prompts/validate-idea.ts:95-99`.
**Severity:** HIGH
**Fix:** Encode the validation matrix as a code-side post-step over the structured report, identical to H1's report-validator.

### H6. Four required tools per §10 build sequence are missing
**What:** Spec §10 lists 6 new tools (4 P0, 2 P1). Current `src/tools/` has only 2 of the 6 new tools shipped (`find-pricing-anchors.ts`, `check-big-tech-encroachment.ts`). Missing:
  - **P0:** `find_why_now_signals` (Gate 5 primary)
  - **P0:** `estimate_demand_signals` (Gate 2 primary)
  - **P1:** `find_public_revenue_signals` (Gate 2 + Gate 4 primary)
  - **P1:** `assess_platform_dependency` (Gate 3 primary)
**Why:** Without these, Gates 2, 3 (partially), and 5 have no primary tool — the LLM will improvise from web search, producing exactly the "plausible-sounding" output the spec exists to prevent. §10: "After Phase 2: v1 can produce a real verdict on all 5 gates." Currently it cannot.
**Where:** `src/tools/` — only `find-pricing-anchors.ts` and `check-big-tech-encroachment.ts` exist of the new six. `src/index.ts:18-27` registers 8 tools total; spec demands 12.
**Severity:** HIGH
**Fix:** Build the 4 missing tools in the order specified in §10: `find_why_now_signals` → `estimate_demand_signals` → `find_public_revenue_signals` → `assess_platform_dependency`.

### H7. Critical Test (§10 Phase 4, §11 DoD) not yet run
**What:** §11 definition of done: *"validate_idea on the AI-native focus app idea returns NO-GO with sound reasoning."* No evidence of a calibration run, fixture, or test case for this in the repo. Without it we don't know whether the structural safeguards (even at the prompt-only level) survive contact with a real idea.
**Why:** §10 Phase 4 lists this as the gating test for shipping v1. §11: "If GO, there's a bug."
**Where:** No fixtures, no test runs in `.planning/` or any test directory.
**Severity:** HIGH (gating)
**Fix:** Run the focus-app idea through `validate_idea` after H6 ships; capture the output as a regression artifact in `.planning/validation-runs/`.

### H8. Soft-failing tool calls (§11 anti-pattern 2) — partial violation
**What:** §11 anti-pattern 2: "Soft-failing tool calls (returning made-up data when the API fails)." The codebase mostly avoids fabrication, but `find-pricing-anchors.ts:152-159` records a Wayback URL as a "source" with `tier: 'S', bias: 'independent'` *without ever fetching the page*. The URL is a search-form pattern (`https://web.archive.org/web/2024*/${domain}/pricing`) — it is not a verified historical snapshot. This is exactly "made-up data when the API fails" wearing an S-tier badge.
**Why:** §11 sound-reasoning test: "A source URL that actually exists and contains the claimed information." A Wayback wildcard URL has no claimed information; it's a search query.
**Where:** `src/tools/find-pricing-anchors.ts:152-159`.
**Severity:** HIGH
**Fix:** Either (a) actually fetch Wayback CDX API and record the real snapshot timestamp, or (b) demote this entry to a "search URL" with `tier: 'D'` and `contribution: "search query — not a verified snapshot"`.

---

## 🟡 MEDIUM — tool quality issues

### M1. `find_pricing_anchors` price parser is noisy
**What:** `extractPriceTiers` in `src/tools/find-pricing-anchors.ts:64-77` uses a regex that captures any digit sequence — so HTML noise like `"8217"` (from a stripped `&#8217;`) or `"474"` (from a CSS class) ends up in the `tiers[]` array as if it were pricing.
**Why:** §11 sound-reasoning test — junk tiers undermine Gate 4 verdicts and pollute the source appendix.
**Where:** `src/tools/find-pricing-anchors.ts:64-77`.
**Severity:** MEDIUM
**Fix:** Require a currency symbol or unit anchor in the regex (`/[\$€£¥]\s*\d+(?:[.,]\d+)?(?:\s*\/\s*(?:mo|month|yr|year|user|seat))?/gi`) and treat bare "free" as a separate flag.

### M2. `find_pricing_anchors` domain guessing fails ~50%
**What:** `extractDomain` / `guessPricingUrl` in `src/tools/find-pricing-anchors.ts:32-51` always appends `.com`. Real-world: Forest is `forestapp.cc`, not `forest.com`; Freedom is `freedom.to`, not `freedom.com`; Cold Turkey is `getcoldturkey.com`. The current strategy will miss every one of those.
**Why:** §11 sound-reasoning — if half the live-pricing fetches fail, Gate 4 falls back to Serper snippets and the report is built on B-tier data while still claiming S-tier sourcing in places.
**Where:** `src/tools/find-pricing-anchors.ts:32-51`.
**Severity:** MEDIUM
**Fix:** Resolve the domain via Serper search (`<competitor> pricing`) first; pick the top result's hostname. Cache the mapping.

### M3. `find_pricing_anchors` Wayback URL is cited but not fetched
**What:** Same line range as H8 — a Wayback wildcard URL is added to `sources` with no fetch. Listed here as MEDIUM-grade noise (HIGH-grade severity already covered in H8 because of the bias-mislabeling).
**Where:** `src/tools/find-pricing-anchors.ts:152-159`.
**Severity:** MEDIUM (overlap with H8)
**Fix:** See H8.

### M4. `check_big_tech_encroachment` acquisition regex extracts article titles, not company names
**What:** `src/tools/check-big-tech-encroachment.ts:234` — `r.title.match(/acquir(?:es?|ed)\s+([A-Z][A-Za-z0-9.&\- ]+?)(?:\s+for|\s+in|[,.])/)`. On real TechCrunch headlines like *"Apple's AI strategy after acquiring Pixelmator hints at..."* this captures `"Pixelmator hints at"` or falls through entirely to `r.title.slice(0, 60)` — the full headline becomes the "target company."
**Why:** Renders acquisition signal meaningless. Gate 3 verdicts may include phantom "acquisitions" of article fragments.
**Where:** `src/tools/check-big-tech-encroachment.ts:234-240`.
**Severity:** MEDIUM
**Fix:** Tighten regex to require an end anchor (`\s+(?:for\s+\$|in\s+a\s+\$|deal)`) AND skip entries when match fails — don't fall back to the headline.

### M5. `check_big_tech_encroachment` conference search misses obvious signals (literal keyword match)
**What:** Conference queries use `${queryBase} site:developer.apple.com` where `queryBase = category + keywords`. For an idea like "AI-native focus app," `queryBase` is something like "focus app deep work" — which will not match WWDC sessions on "Apple Intelligence," "Screen Time," or "Focus Modes" (which is the literal name of a system feature). The classic killshot case in §10 Phase 4 will be missed.
**Why:** §11 definition-of-done: focus-app idea must return NO-GO. Gate 3 is supposed to flag Apple Intelligence + iOS Focus modes — the current query phrasing will not surface either.
**Where:** `src/tools/check-big-tech-encroachment.ts:138, 146`.
**Severity:** MEDIUM
**Fix:** Expand each hyperscaler search with a synonym map (`focus app` → `Focus Modes`, `Screen Time`, `Digital Wellbeing`, `Apple Intelligence`, `Copilot`) — derived from a static category-to-platform-feature map, or generated by a sub-prompt at tool invocation time.

### M6. `scan_producthunt_launches` returns empty / wrong results for plain category queries
**What:** The PH client searches by raw category string (`searchProductHunt(category, 15)` at `src/tools/scan-producthunt-launches.ts:59`). For "focus app" the PH GraphQL search returns largely empty or off-topic launches; filtering happens client-side via topics, but there's no fallback to topic-based search. Live testing showed empty results for the canonical test idea.
**Why:** PH is one of the five tools used in `quick_kill_check` and feeds G1/G2/G5 secondary evidence. Empty = silent gap, not a flagged gap.
**Where:** `src/lib/producthunt.ts` (search function), `src/tools/scan-producthunt-launches.ts:59`.
**Severity:** MEDIUM
**Fix:** Add a topic-resolution step (PH has a topics API) — convert category → topic slug → posts query. If topic search returns nothing, log that fact in `confidence_note` rather than returning an empty `launches[]` array with no warning.

### M7. Reddit refactor: spec implied OAuth API; current code uses Serper site search
**What:** `src/lib/reddit.ts:1-15` documents the divergence honestly: Reddit data is fetched via `serperSearch(query + ' site:reddit.com')` instead of Reddit OAuth. Tier was reduced A → B in `redditSource` (line 91). This is a documented design choice but worth surfacing.
**Why:** §4 lists Reddit subscriber counts and posting activity as tier-A signals. Current implementation cannot return subscriber counts at all (`score: 0, num_comments: 0, created_utc: 0` — lines 71-75), and `estimate_demand_signals` (when built) is supposed to return "top relevant subreddit sizes + posting activity" which Serper site-search cannot provide.
**Where:** `src/lib/reddit.ts:58-80`.
**Severity:** MEDIUM (acceptable for now, but blocks part of `estimate_demand_signals`)
**Fix:** When `estimate_demand_signals` is built, add a separate Reddit API client (or a public `/r/<sub>/about.json` fetch — no auth required for subscriber counts) and reserve Serper for in-thread content extraction.

### M8. No tool-result caching across a single `validate_idea` run
**What:** §2 + §7 "Tool reuse rule": `find_closest_competitor` is supposed to be called *once* and referenced in G2 + G4. `src/lib/cache.ts` exists (30 lines) but is not wired into any tool. Each gate that the LLM walks through will re-invoke tools.
**Why:** §11 DoD: "Tool call budget stays under 20 tool calls per `validate_idea` run." Without caching, the LLM will burn through that budget on duplicate calls.
**Where:** `src/lib/cache.ts` (unused by any tool); no tool checks the cache.
**Severity:** MEDIUM
**Fix:** Wrap each tool's main fetch in `cache.get/set` keyed by tool name + normalized args; TTL = one session.

### M9. `confidence_note` math is wrong in `find_pricing_anchors`
**What:** `find-pricing-anchors.ts:281-285` computes `fetchedCount` by checking *if any* source has a "Live pricing" contribution — then multiplies that boolean across every competitor: `current_pricing.filter((_p) => sources.some(...))`. So if 1 of 4 competitors fetched live, all 4 are reported as "live fetched."
**Why:** §11 sound-reasoning. Confidence inflated, audit trail wrong.
**Where:** `src/tools/find-pricing-anchors.ts:281-288`.
**Severity:** MEDIUM
**Fix:** Track `fetchedSuccessfully` per competitor (the variable already exists at line 132) and push to a counter in the loop.

---

## 🟢 LOW — hygiene

### L1. No automated tests
**What:** No `*.test.ts` / `*.spec.ts` anywhere; no test runner in `package.json` scripts.
**Why:** §11 DoD includes a "Critical Test" run on the focus-app idea. Without regression coverage, fixing M1–M9 risks silently breaking the safeguards in H1–H5.
**Where:** Repo-wide.
**Severity:** LOW (rises to HIGH after v1 ships)
**Fix:** Add Vitest. Start with unit tests for the parsers most likely to drift (`extractPriceTiers`, `detectRecency`, acquisition regex). Add one end-to-end snapshot test that runs `validate_idea` against the focus-app fixture.

### L2. Stale branches
**What:** Local + remote branches `weather-mcp`, `research-v1`, `research-v2`, `pensive-newton-2f202f`, `priceless-haslett-797a93` still present. `weather-mcp` is from the pre-product-validation scaffolding.
**Why:** Branch noise; unclear which is canonical history.
**Where:** `git branch -a`.
**Severity:** LOW
**Fix:** Delete merged branches; archive `weather-mcp` if it has historical value.

### L3. Only stdio transport; only Claude Desktop tested
**What:** `src/index.ts:99` hardcodes `StdioServerTransport`. §11 DoD requires the prompts to be "callable from Claude Desktop / Cursor / Claude Code." Cursor and Claude Code have not been verified.
**Why:** Distribution risk — if Cursor's MCP client variant rejects a prompt shape, we ship broken.
**Where:** `src/index.ts:99`.
**Severity:** LOW
**Fix:** Smoke-test in Cursor and Claude Code; document expected setup in README.

### L4. `find-pricing-anchors` regex flags use mixed `i`/no-`i`
**What:** Lines 55, 57, 59 already lowercase the input (`const lower = text.toLowerCase()`) then apply `/.../i` regexes redundantly. Cosmetic.
**Severity:** LOW
**Fix:** Drop the `i` flag or drop the `toLowerCase()`.

### L5. Dotenv loaded relative to `dirname(import.meta.url)` joined with `..`
**What:** `src/index.ts:13-16` assumes the built file lives one directory under the package root. Works for `build/index.js`, breaks if someone runs `tsx src/index.ts` from a different cwd.
**Severity:** LOW
**Fix:** Walk up looking for `package.json`, or use `process.env` only and document the requirement.

---

## Cross-cutting recommendation

H1–H5 share one fix: **a structured report-validator step** that runs *after* the LLM emits the markdown artifact and *before* it is returned to the user. That single component would convert four of the five anti-bias mechanisms from "we hope the model follows the prompt" into "the server refuses to return non-compliant output." Build it before iterating further on tool quality (M1–M9), or the tool fixes will outrun the safeguards.

---

*Concerns audit: 2026-05-20*
