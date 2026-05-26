# Codebase Concerns

**Analysis Date:** 2026-05-20
**Spec audited against:** `.planning/spec/build-spec-v1.0.md` (v1.0)

Severity-ordered. Each item maps to a spec section. Honest read — do not soften.

---

## Phase 01 Resolution Summary (2026-05-20)

**All 8 HIGH concerns CLOSED.** See per-item resolution notes below.

- Calibration: `.planning/validation-runs/01-fomi-focus-app.md` returns NO-GO with sourced killshots
- Mechanical verification: `scripts/assert-fomi-run.ts` (6/6 assertions PASS, exit code 0)
- 12 tools registered (was 8 at start of phase) + 1 finalize tool
- Build green throughout (19 atomic commits, 0 broken builds, 0 rollbacks)

MEDIUM and LOW concerns remain open per Phase 01 scope (`CONTEXT.md` "Out of scope").

---

## 🔴 HIGH — fundamentals at risk

These concerns threaten the "single defining design goal" (§1): *making confirmation bias structurally impossible*. If any of the 5 anti-bias mechanisms is only described in prompt text but not enforced in code, the MCP is functionally a plausible-sounding wrapper around an LLM, which is exactly what the spec says it must NOT be.

### H1. DOK layering is instruction-only — no code enforcement
**What:** The five anti-bias mechanisms (§1) include "DOK 1→4 layering" and "Contradicting Evidence search is a *required step*". In code, both exist only as instructions to the LLM inside `src/prompts/validate-idea.ts` (lines 33–46, 56–65, 159–164). There is no validator that rejects a model output missing DOK 2/3/4 separation or missing the Contradicting Evidence block.
**Why:** §1 warns: "If any of these mechanisms are skipped or watered down during implementation, the MCP loses the property that makes it valuable." A prompt-only safeguard is a watered-down implementation — the LLM can and will skip steps under load, and nothing in the server detects it.
**Where:** `src/prompts/validate-idea.ts:33-46`, `:56-65`, `:159-164`, `:185-195` (anti-pattern checklist is also LLM-side).
**Severity:** HIGH
**Fix:** Add a post-generation validator prompt or a structured-output schema (e.g., zod schema for the report sections) that fails closed if a gate block is missing DOK 1/2/3/4 + Contradicting Evidence. At minimum, ship a `validate_report` tool the prompt is forced to call before emitting the final artifact.
**RESOLVED (Phase 01, 2026-05-20):** Code-enforced via `src/validation/structural-validator.ts` (rejects fundamental DOK-separation / Contradicting-Evidence violations); `finalize_validation_report` tool refuses to render markdown when fundamentals fail; master prompt rewritten to JSON-only — markdown escape hatch closed — see commits 67af958 23d67f6 53a26a9 + evidence at `.planning/validation-runs/01-fomi-focus-app.md` (T20 assertion 6 PASS).

### H2. "Your Spiky POV" blank-section guarantee is also instruction-only
**What:** §1 lists the blank "Your Spiky POV" as one of the 5 anti-bias mechanisms; §11 lists "Filling in Your Spiky POV section automatically" as an anti-pattern to reject. Enforcement lives only in prompt text (`src/prompts/validate-idea.ts:119-121`, `:171-172`, `:195`).
**Why:** Same as H1 — a sufficiently confident model will helpfully populate that section, killing the user's required DOK 4. Code cannot currently detect or strip a populated POV block.
**Where:** `src/prompts/validate-idea.ts:119-121`, `:171-172`.
**Severity:** HIGH
**Fix:** Post-process the artifact to assert the "Your Spiky POV" block matches the empty template; refuse to render otherwise.
**RESOLVED (Phase 01, 2026-05-20):** Defense-in-depth at three layers — `src/validation/renderer.ts` ignores `report.spiky_pov` entirely and emits `SPIKY_POV_BLANK_TEMPLATE` constant; structural validator refuses populated POV; prompt instructs blank — see commits 6686388 67af958 53a26a9 + evidence at `.planning/validation-runs/01-fomi-focus-app.md` (T20 assertion 6 PASS).

### H3. `unknown` bias flag default not codified — only mentioned in markdown
**What:** §4 rule 4 and §11 anti-pattern 6: *"Defaulting `unknown` bias flag to 'independent' (must default to 'vendor-funded')."* The rule is documented in `src/resources/source-tier-bias.md` but is never enforced in any tool. Tools either hardcode `'independent'`, `'conflicted'`, `'vendor-funded'` (e.g. `find-pricing-anchors.ts:155`, `check-big-tech-encroachment.ts:172, 245`), or leave bias decisions to the LLM. There is no helper like `resolveBias(flag)` that converts `unknown → vendor-funded` for confidence math.
**Why:** §11 explicitly calls this out as anti-pattern 6. §4 rule 4: *"`unknown` = treat as `vendor-funded` for confidence math."* Without a code-level helper, the LLM will silently treat `unknown` sources as neutral, inflating PASS verdicts.
**Where:** `src/types.ts` defines the union; no consumer enforces the substitution. Search `src/` — no occurrence of `unknown` being remapped.
**Severity:** HIGH
**Fix:** Add a `src/lib/bias.ts` with `effectiveBias(flag)` and `requiresUpgradeFromUnknown(sources)`; use it wherever confidence math touches sources. Document in `validate_idea` prompt that the LLM must call it (or have the report validator do it).
**RESOLVED (Phase 01, 2026-05-20):** `src/lib/bias.ts` exports `effectiveBias(flag)` which maps `unknown → vendor-funded` for confidence math; wired into all tools doing confidence math; raw bias preserved on the wire for transparency — see commits 62cb855 eee95af + evidence at `find_public_revenue_signals` `confidence_note` example.

### H4. PASS-requires-≥2-tier-B rule (§4 rule 1) not enforced in code
**What:** Tools return sources with tiers, but no code aggregates per-gate and rejects PASS verdicts with <2 tier-B-or-higher independent sources. Rule lives only in `validate-idea.ts:41` as a prompt instruction.
**Why:** §11 definition-of-done item: "validate_idea on the AI-native focus app idea returns NO-GO with sound reasoning". Without enforcement, the LLM can claim PASS on a single C-tier source.
**Where:** No file. The rule exists as English in the prompt and resource markdown only.
**Severity:** HIGH
**Fix:** Same as H1 — a report validator that counts sources per gate and downgrades verdicts mechanically.
**RESOLVED (Phase 01, 2026-05-20):** `src/validation/verdict-validator.ts` downgrades any PASS gate with <2 tier-S/A/B sources to INCONCLUSIVE; fail-2 rule recomputed after gate-level adjustments — see commit a297f53 + evidence at `.planning/validation-runs/01-fomi-focus-app-tool-response.json` `adjustments_made[]` (Gates 1, 3, 4 visibly downgraded due to >30% conflicted).

### H5. Validation Checks decision matrix (§3 / §11 anti-pattern 5) not enforced
**What:** §11 anti-pattern 5: "Rendering GO verdicts when validation checks have major issues." The override rule (Major → Low confidence; Fundamental → Inconclusive) lives in `validate-idea.ts:95-99` as instruction. No code applies it.
**Why:** §2 key technical decisions: "Verdict authority — Validation Checks can override gate math". This is supposed to be mechanical — the spec uses the word "override," not "suggest."
**Where:** `src/prompts/validate-idea.ts:95-99`.
**Severity:** HIGH
**Fix:** Encode the validation matrix as a code-side post-step over the structured report, identical to H1's report-validator.
**RESOLVED (Phase 01, 2026-05-20):** `src/validation/verdict-validator.ts` mutates verdicts based on Validation Check severities — Major → confidence Low; Fundamental → overall INCONCLUSIVE. Mechanical, not LLM-discretionary — see commit a297f53 + evidence at `.planning/validation-runs/01-fomi-focus-app.md` (T20 assertion 6 PASS).

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
**RESOLVED (Phase 01, 2026-05-20):** All 4 tools shipped and wired: `find_why_now_signals` (8e5b7b1 / wiring 8fd70f3), `estimate_demand_signals` (fc8cc6e / 831dee3), `find_public_revenue_signals` (b6dce3b / 2d656b9), `assess_platform_dependency` (4c431c2 / 1acd564); plus D-T04-1 fix for YC RFS bias mislabeling (ceee881). `src/index.ts` now registers 12 spec tools + 1 finalize tool = 13 total.

### H7. Critical Test (§10 Phase 4, §11 DoD) not yet run
**What:** §11 definition of done: *"validate_idea on the AI-native focus app idea returns NO-GO with sound reasoning."* No evidence of a calibration run, fixture, or test case for this in the repo. Without it we don't know whether the structural safeguards (even at the prompt-only level) survive contact with a real idea.
**Why:** §10 Phase 4 lists this as the gating test for shipping v1. §11: "If GO, there's a bug."
**Where:** No fixtures, no test runs in `.planning/` or any test directory.
**Severity:** HIGH (gating)
**Fix:** Run the focus-app idea through `validate_idea` after H6 ships; capture the output as a regression artifact in `.planning/validation-runs/`.
**RESOLVED (Phase 01, 2026-05-20):** Fomi (AI-native focus app) calibration captured at `.planning/validation-runs/01-fomi-focus-app.md`. Verdict: NO-GO with 3 killshots citing tier-S/A sources; 12 tool calls (under §11 budget of 20). Mechanical assertion script `scripts/assert-fomi-run.ts` verifies all 6 acceptance checks (`npx tsx scripts/assert-fomi-run.ts` exits 0 with `6/6 assertions passed`) — see commits c2f961f becf0e1 + evidence at `.planning/validation-runs/01-fomi-focus-app.md`.

### H8. Soft-failing tool calls (§11 anti-pattern 2) — partial violation
**What:** §11 anti-pattern 2: "Soft-failing tool calls (returning made-up data when the API fails)." The codebase mostly avoids fabrication, but `find-pricing-anchors.ts:152-159` records a Wayback URL as a "source" with `tier: 'S', bias: 'independent'` *without ever fetching the page*. The URL is a search-form pattern (`https://web.archive.org/web/2024*/${domain}/pricing`) — it is not a verified historical snapshot. This is exactly "made-up data when the API fails" wearing an S-tier badge.
**Why:** §11 sound-reasoning test: "A source URL that actually exists and contains the claimed information." A Wayback wildcard URL has no claimed information; it's a search query.
**Where:** `src/tools/find-pricing-anchors.ts:152-159`.
**Severity:** HIGH
**Fix:** Either (a) actually fetch Wayback CDX API and record the real snapshot timestamp, or (b) demote this entry to a "search URL" with `tier: 'D'` and `contribution: "search query — not a verified snapshot"`.
**RESOLVED (Phase 01, 2026-05-20):** Replaced wildcard URL fabrication with real Wayback CDX API client (`src/lib/wayback.ts`); `find_pricing_anchors` now only cites Wayback URLs when verified snapshots exist — see commits 83799ad d54ecf5 + evidence (smoke test): `fallbacks_used: ["wayback (no snapshots found for ...)"]` when no snapshot exists; no phantom S-tier source recorded.

---

## Phase 02 Resolution Summary (2026-05-25)

**All 9 MEDIUM concerns + 3 Phase-01 deferred items CLOSED.** D-T07-1 (PH topics API auth) marked as graceful-degradation flag (not a bug).

- Tool quality fixes: 11 atomic commits across Streams A/B/C/D (M1, M2, M4, M5, M6, M9, D-01, D-T04-2, D-T16-1; M3 + M7 verified pre-closed)
- Cache wiring: 6 orchestrator tools wrapped (cold 11.7s → warm 0ms)
- Test harness: Vitest + 8 test files + 70 assertions (L1 closed)
- Build green throughout (~22 atomic commits)

---

## 🟡 MEDIUM — tool quality issues

### M1. `find_pricing_anchors` price parser is noisy
**What:** `extractPriceTiers` in `src/tools/find-pricing-anchors.ts:64-77` uses a regex that captures any digit sequence — so HTML noise like `"8217"` (from a stripped `&#8217;`) or `"474"` (from a CSS class) ends up in the `tiers[]` array as if it were pricing.
**Why:** §11 sound-reasoning test — junk tiers undermine Gate 4 verdicts and pollute the source appendix.
**Where:** `src/tools/find-pricing-anchors.ts:64-77`.
**Severity:** MEDIUM
**Fix:** Require a currency symbol or unit anchor in the regex (`/[\$€£¥]\s*\d+(?:[.,]\d+)?(?:\s*\/\s*(?:mo|month|yr|year|user|seat))?/gi`) and treat bare "free" as a separate flag.
**RESOLVED (Phase 02, 2026-05-25):** `extractPriceTiers` regex tightened to require currency anchor — HTML-noise digits (e.g. `&#8217;`, CSS class numerics) no longer surface as tiers — see commits a74737f + a49d328 (T-V03 regression test) + evidence at `src/tools/find-pricing-anchors.test.ts` (10 assertions including 3 HTML-noise negatives).

### M2. `find_pricing_anchors` domain guessing fails ~50%
**What:** `extractDomain` / `guessPricingUrl` in `src/tools/find-pricing-anchors.ts:32-51` always appends `.com`. Real-world: Forest is `forestapp.cc`, not `forest.com`; Freedom is `freedom.to`, not `freedom.com`; Cold Turkey is `getcoldturkey.com`. The current strategy will miss every one of those.
**Why:** §11 sound-reasoning — if half the live-pricing fetches fail, Gate 4 falls back to Serper snippets and the report is built on B-tier data while still claiming S-tier sourcing in places.
**Where:** `src/tools/find-pricing-anchors.ts:32-51`.
**Severity:** MEDIUM
**Fix:** Resolve the domain via Serper search (`<competitor> pricing`) first; pick the top result's hostname. Cache the mapping.
**RESOLVED (Phase 02, 2026-05-25):** Serper-based competitor → hostname resolution with `www.` variant fallback. Forest/Cold Turkey/Opal now resolve to forestadmin.com/getcoldturkey.com/opal.so (was `.com` guess and miss). Also closes D-01 (`www.` host mismatch for Wayback) — see commit 5213442 + smoke-test evidence in commit body.

### M3. `find_pricing_anchors` Wayback URL is cited but not fetched
**What:** Same line range as H8 — a Wayback wildcard URL is added to `sources` with no fetch. Listed here as MEDIUM-grade noise (HIGH-grade severity already covered in H8 because of the bias-mislabeling).
**Where:** `src/tools/find-pricing-anchors.ts:152-159`.
**Severity:** MEDIUM (overlap with H8)
**Fix:** See H8.
**Verified closed by Phase 02 T04 (covered by Phase 01 H8 fix).** Audit grep `web\.archive\.org/web/[^0-9]` on `src/tools/find-pricing-anchors.ts` returns zero matches. Only Wayback references remaining are (1) a Serper search query string (`site:web.archive.org`) and (2) a `historyResults` snippet-filter check — neither writes a Wayback URL into `sources`. All `sources` Wayback entries route through `waybackSource(snapshot, ...)` which fires only when `waybackLookup()` returns a real timestamped snapshot. Live smoke (3 competitors) returned only real-timestamp snapshot URLs (e.g. `web/20260510041848`, `web/20180720081744`) — no wildcards. See `.planning/phases/02-tool-quality-and-test-harness/m3-verification.md`.
**RESOLVED (Phase 02, 2026-05-25):** Pre-closed by Phase 01 H8 fix (commit d54ecf5 — real Wayback CDX API client). Phase 02 T04 confirmed no regression — see commit 34496f9 + evidence at `.planning/phases/02-tool-quality-and-test-harness/m3-verification.md`.

### M4. `check_big_tech_encroachment` acquisition regex extracts article titles, not company names
**What:** `src/tools/check-big-tech-encroachment.ts:234` — `r.title.match(/acquir(?:es?|ed)\s+([A-Z][A-Za-z0-9.&\- ]+?)(?:\s+for|\s+in|[,.])/)`. On real TechCrunch headlines like *"Apple's AI strategy after acquiring Pixelmator hints at..."* this captures `"Pixelmator hints at"` or falls through entirely to `r.title.slice(0, 60)` — the full headline becomes the "target company."
**Why:** Renders acquisition signal meaningless. Gate 3 verdicts may include phantom "acquisitions" of article fragments.
**Where:** `src/tools/check-big-tech-encroachment.ts:234-240`.
**Severity:** MEDIUM
**Fix:** Tighten regex to require an end anchor (`\s+(?:for\s+\$|in\s+a\s+\$|deal)`) AND skip entries when match fails — don't fall back to the headline.
**RESOLVED (Phase 02, 2026-05-25):** Acquisition regex tightened with end-anchor + drops entries on fallthrough (no headline-as-target fallback). Trade-off (real acquisitions without `for $X` shape are dropped) is locked in by negative test fixtures — see commits 3a1eef6 + 9b3fcca (T-V05 regression test) + evidence at `src/tools/check-big-tech-encroachment.test.ts` (12 assertions including 7 negatives).

### M5. `check_big_tech_encroachment` conference search misses obvious signals (literal keyword match)
**What:** Conference queries use `${queryBase} site:developer.apple.com` where `queryBase = category + keywords`. For an idea like "AI-native focus app," `queryBase` is something like "focus app deep work" — which will not match WWDC sessions on "Apple Intelligence," "Screen Time," or "Focus Modes" (which is the literal name of a system feature). The classic killshot case in §10 Phase 4 will be missed.
**Why:** §11 definition-of-done: focus-app idea must return NO-GO. Gate 3 is supposed to flag Apple Intelligence + iOS Focus modes — the current query phrasing will not surface either.
**Where:** `src/tools/check-big-tech-encroachment.ts:138, 146`.
**Severity:** MEDIUM
**Fix:** Expand each hyperscaler search with a synonym map (`focus app` → `Focus Modes`, `Screen Time`, `Digital Wellbeing`, `Apple Intelligence`, `Copilot`) — derived from a static category-to-platform-feature map, or generated by a sub-prompt at tool invocation time.
**RESOLVED (Phase 02, 2026-05-25):** Category → platform-feature synonym map fans hyperscaler queries (focus app → Focus Modes, Screen Time, Digital Wellbeing, Apple Intelligence, Copilot, etc.). Smoke showed sources before=12 → after=39, with 12 matching synonym keywords — see commit 0e64097 + smoke-test evidence in commit body.

### M6. `scan_producthunt_launches` returns empty / wrong results for plain category queries
**What:** The PH client searches by raw category string (`searchProductHunt(category, 15)` at `src/tools/scan-producthunt-launches.ts:59`). For "focus app" the PH GraphQL search returns largely empty or off-topic launches; filtering happens client-side via topics, but there's no fallback to topic-based search. Live testing showed empty results for the canonical test idea.
**Why:** PH is one of the five tools used in `quick_kill_check` and feeds G1/G2/G5 secondary evidence. Empty = silent gap, not a flagged gap.
**Where:** `src/lib/producthunt.ts` (search function), `src/tools/scan-producthunt-launches.ts:59`.
**Severity:** MEDIUM
**Fix:** Add a topic-resolution step (PH has a topics API) — convert category → topic slug → posts query. If topic search returns nothing, log that fact in `confidence_note` rather than returning an empty `launches[]` array with no warning.
**RESOLVED (Phase 02, 2026-05-25):** PH topics API resolution wired into `scan_producthunt_launches`; `confidence_note` reports actual fetch path (topic-resolved vs. query-string fallback vs. API unauthorized). D-T07-1 documents the PH API auth-scope limitation as a graceful-degradation flag, not a bug — see commits 68f7a54 + 2b7eacb + evidence at `.planning/phases/02-tool-quality-and-test-harness/deferred-items.md` (D-T07-1).

### M7. Reddit refactor: spec implied OAuth API; current code uses Serper site search
**What:** `src/lib/reddit.ts:1-15` documents the divergence honestly: Reddit data is fetched via `serperSearch(query + ' site:reddit.com')` instead of Reddit OAuth. Tier was reduced A → B in `redditSource` (line 91). This is a documented design choice but worth surfacing.
**Why:** §4 lists Reddit subscriber counts and posting activity as tier-A signals. Current implementation cannot return subscriber counts at all (`score: 0, num_comments: 0, created_utc: 0` — lines 71-75), and `estimate_demand_signals` (when built) is supposed to return "top relevant subreddit sizes + posting activity" which Serper site-search cannot provide.
**Where:** `src/lib/reddit.ts:58-80`.
**Severity:** MEDIUM (acceptable for now, but blocks part of `estimate_demand_signals`)
**Fix:** When `estimate_demand_signals` is built, add a separate Reddit API client (or a public `/r/<sub>/about.json` fetch — no auth required for subscriber counts) and reserve Serper for in-thread content extraction.
**VERIFIED CLOSED (Phase 02, 2026-05-25):** Pre-closed by Phase 01 T12b (`getSubredditMeta` no-auth fetch via `about.json` for subscriber counts; Serper retained for in-thread content). No Phase 02 code change required — see commit 2455447 (Phase 01) + `src/lib/reddit.ts` `getSubredditMeta`.

### M8. No tool-result caching across a single `validate_idea` run
**What:** §2 + §7 "Tool reuse rule": `find_closest_competitor` is supposed to be called *once* and referenced in G2 + G4. `src/lib/cache.ts` exists (30 lines) but is not wired into any tool. Each gate that the LLM walks through will re-invoke tools.
**Why:** §11 DoD: "Tool call budget stays under 20 tool calls per `validate_idea` run." Without caching, the LLM will burn through that budget on duplicate calls.
**Where:** `src/lib/cache.ts` (unused by any tool); no tool checks the cache.
**Severity:** MEDIUM
**Fix:** Wrap each tool's main fetch in `cache.get/set` keyed by tool name + normalized args; TTL = one session.
**RESOLVED (Phase 02, 2026-05-25):** Tool-layer caching wired into 6 orchestrator tools (TTL.SHORT). Smoke showed cold call 11.7s → warm call 0ms — see commits d1ce9fc (T11 audit identifying 6 tools) + fce5b0b (T12 wiring) + 5932894 (T-V08 cache-hit regression test) + evidence at `.planning/phases/02-tool-quality-and-test-harness/m8-cache-audit.md`.

### M9. `confidence_note` math is wrong in `find_pricing_anchors`
**What:** `find-pricing-anchors.ts:281-285` computes `fetchedCount` by checking *if any* source has a "Live pricing" contribution — then multiplies that boolean across every competitor: `current_pricing.filter((_p) => sources.some(...))`. So if 1 of 4 competitors fetched live, all 4 are reported as "live fetched."
**Why:** §11 sound-reasoning. Confidence inflated, audit trail wrong.
**Where:** `src/tools/find-pricing-anchors.ts:281-288`.
**Severity:** MEDIUM
**Fix:** Track `fetchedSuccessfully` per competitor (the variable already exists at line 132) and push to a counter in the loop.
**RESOLVED (Phase 02, 2026-05-25):** Per-competitor `fetchedSuccessfully` counter wired into `confidence_note`. Smoke showed "2 of 3 fetched live" (true) replacing the prior "3 of 3" (false) — see commit fa75385 + smoke-test evidence in commit body.

---

## 🟢 LOW — hygiene

### L1. No automated tests
**What:** No `*.test.ts` / `*.spec.ts` anywhere; no test runner in `package.json` scripts.
**Why:** §11 DoD includes a "Critical Test" run on the focus-app idea. Without regression coverage, fixing M1–M9 risks silently breaking the safeguards in H1–H5.
**Where:** Repo-wide.
**Severity:** LOW (rises to HIGH after v1 ships)
**Fix:** Add Vitest. Start with unit tests for the parsers most likely to drift (`extractPriceTiers`, `detectRecency`, acquisition regex). Add one end-to-end snapshot test that runs `validate_idea` against the focus-app fixture.
**RESOLVED (Phase 02, 2026-05-25):** Vitest installed + 8 test files + 70 assertions covering parsers, helpers, and renderer snapshot — see commits 8bc95e3 (T-V01 Vitest install) + 35db649 (T-V02) + a49d328 (T-V03) + c906375 (T-V04) + 9b3fcca (T-V05) + e8bbe7b (T-V06) + 6b18b87 (T-V07) + 5932894 (T-V08) + d730a1c (T-V09). Evidence: `npm test` passes 70/70 across 8 files.

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

## Phase 03 Deferred Items (2026-05-26)

Phase 03 (Multi-Tenant HTTPS Transport) shipped the HTTPS transport / auth / rate-limit / persistence / observability / landing / admin-dashboard stack as a wrapper around the existing `McpServer`. The transport layer was added without touching Phase 01's inviolate validator pipeline or Phase 02's tool-quality fixes — no Phase 01 or Phase 02 RESOLVED entry above is modified.

The following entries were discovered (or settled at PLAN-CHECK time) during Phase 03 and tracked for future revisit. See `.planning/phases/03-multitenant-https/deferred-items.md` for the full disposition narrative for each.

**Branch nomenclature:** Phase 03 shipped from `phase-v3` → `main`. Future phases use `phase-vN` (no underscores, no trailing version suffix beyond N).

### D-03-1 — Cache hit-rate instrumentation deferred

**Discovered during:** Phase 03 T22 (enrich `/health` with subsystem fields).
**File:** `src/http/server.ts` (health handler) + `src/lib/cache.ts` (uninstrumented).
**Symptom:** `/health` returns `cache_hit_rate: null` because `src/lib/cache.ts` has no hit/miss counters. T22 wired the field but left it null pending instrumentation.
**Impact:** No observability into cache effectiveness. The Phase 02 cache wiring (cold 11.7s → warm 0ms) works, but operationally we can't see hit-rate drift if a future refactor accidentally bypasses the cache.
**Why deferred:** Adding hit/miss counters + a `cacheStats()` export is a separate concern from the HTTPS transport layer. Scope-bounded for Phase 04.
**Suggested fix:** Add `hits` + `misses` counters to `src/lib/cache.ts`'s `get`/`set` paths; export `cacheStats(): { hits, misses, hit_rate }`. Wire into T22's health handler so `cache_hit_rate` returns a real number.

### D-03-1-a — Global Serper cap = graceful degradation at `src/lib/serper.ts`, NOT a 429 from the HTTP layer

**Discovered during:** Phase 03 PLAN-CHECK v0.1 → v0.2 (concern C7 disposition).
**File:** `src/lib/serper.ts` (graceful-degradation site); `src/ratelimit/global.ts` (cap check); `src/ratelimit/middleware.ts` (does NOT pre-check the global cap).
**Symptom (by design):** When the 1,500-call UTC-day Serper cap fires, downstream tools surface `fallbacks_used: ['serper_global_cap']` in the response envelope, source tier downgrades to D / bias unknown — same shape as when the API key is absent. The HTTP layer returns 200, not 429. 429 is reserved exclusively for the per-token cap (T11/T13).
**Impact:** Honors spec §11 anti-pattern 2 (never fail silently — gap surfaced honestly) + §7 graceful degradation. Trade-off: from the admin's perspective there is no HTTP-status signal that the global cap fired; observability comes from log greps (`serper_global_cap`) and the response envelope, not from response codes.
**Why deferred:** The 429-style global cap surface is rejected for v1; revisit only if operational experience shows the log/envelope signal is insufficient.
**Suggested fix (if revisited):** Add an `X-Vetoed-Global-Cap-Hit: true` advisory header on responses that touched the cap, OR expose `/admin/api/serper-status` to surface today's count. Don't change the 200-status semantics — that contract is locked.

### D-03-2 — Token prefix is the first 7 chars (`pv_xxxxx`), NOT the last 4

**Discovered during:** Phase 03 PLAN-CHECK v0.1 → v0.2 (concern C8 disposition).
**File:** `src/auth/tokens.ts` (issue/list paths); CONTEXT.md v0.2 (canonical).
**Symptom:** CONTEXT.md v0.1 said "last 4 chars" for the stored token prefix; v0.2 settles on **first 7 chars** so the `pv_` discriminator is preserved in the prefix and the prefix is grep-friendly (`grep pv_a1b2c logs/*` finds a specific token's audit trail).
**Impact:** None at code level — no tokens were issued under v0.1's "last 4" rule (the schema landed at v0.2 already). This entry documents the decision so a future reader doesn't try to "fix" the prefix to match an out-of-date doc.
**Why deferred:** Settled in v0.2; tracked here so the decision is grep-findable. No code change required.
**Suggested fix:** None. The first-7-char prefix is the lock-in; `grep -nE "substring\(0,\s*7\)|slice\(0,\s*7\)" src/auth/tokens.ts` enforces the contract.

### D-03-3 — Single-region deploy; multi-region deferred

**Discovered during:** Phase 03 CONTEXT.md decision 3 (Fly.io hosting, "One region to start (probably IAD or LHR)").
**File:** `fly.toml` (`primary_region = "iad"`).
**Symptom:** Phase 03 ships from a single Fly region (IAD). Users in Europe / APAC will see additional ~100–200ms latency on every `tools/call`.
**Impact:** Latency is acceptable for `validate_idea` (LLM-orchestrated, multi-second runtime — single-region overhead is noise). For lighter `tools/call` workloads it's noticeable; not blocking.
**Why deferred:** Multi-region requires per-region SQLite replication (LiteFS) or a Postgres migration. Out-of-scope per CONTEXT.md ("until latency complaints emerge").
**Suggested fix:** Phase 04 candidate gated on user feedback. Likely route: LiteFS for SQLite, OR migrate persistence to Postgres + Fly's managed Postgres in a primary region with read replicas.

### D-03-4 — Tool-call-level rate limit (vs prompt-level); T11 threshold = 400 calls/day

**Discovered during:** Phase 03 PLAN-CHECK v0.1 → v0.2 (concern C6 disposition).
**File:** `src/ratelimit/per-token.ts` (file-header math comment).
**Symptom:** The MCP server cannot observe a "prompt invocation" — prompts are LLM-side orchestration; only `tools/call` requests cross the wire. So the per-token rate limit is enforced at the tool-call layer, not the prompt layer.
**Impact:** Threshold math (documented verbatim in `src/ratelimit/per-token.ts` file header AND `docs/HOSTED_SETUP.md`): 20 `validate_idea` runs/day × 20 tool calls/run (spec §11 UPPER bound) = **400 tool calls / day / token**. Typical (~13 tool calls/run) = ~30 runs / day. A user hitting the 400-call ceiling has usually run ~30 typical validations — well past the 20-run guarantee. The user-facing budget headline ("20 runs/day") holds at the spec upper bound.
**Why deferred:** Revisit only if user feedback shows the tool-call ceiling maps awkwardly to the user-facing run budget. The mapping is documented in `docs/HOSTED_SETUP.md` Section 4.
**Suggested fix (if revisited):** Add a `validate_idea`-completion sentinel signal (e.g., a final `tools/call` to `finalize_validation_report` triggers a per-run counter increment) and rate-limit at both layers. Adds plumbing but tightens the user-visible budget. Phase 04 candidate.

### D-03-5 — Self-serve email-collection form vs mailto CTA

**Discovered during:** Phase 03 CONTEXT.md decision 4 (Stream F1 landing) + R7 (minimum-viable copy).
**File:** `public/index.html` (mailto CTA target).
**Symptom:** Landing page CTA is `<a href="mailto:aljosa@getvetoed.com?subject=Vetoed%20access%20request">Request access</a>` — no in-page form, no automation.
**Impact:** Manual admin step per signup (Aljosa runs `flyctl ssh console -a vetoed-mcp` → `npm run admin -- issue-token --email=...` → emails the token back). Acceptable at v1 user volume.
**Why deferred:** Self-serve onboarding requires an OAuth provider (Google sign-in) or a magic-link email flow. Both are Phase 04 per CONTEXT.md out-of-scope.
**Suggested fix:** Phase 04 candidate (per CONTEXT.md: "OAuth 2.1 / Sign-in-with-Google — Phase 04 if user count > 50").

### D-03-6 — `bin.weather` scaffold leftover in `package.json`

**Discovered during:** Phase 03 PLAN-CHECK v0.1 → v0.2 (OQ3 resolution).
**File:** `package.json` (`"bin": { "weather": "./build/index.js" }`).
**Symptom:** The `bin.weather` field is a Phase 00 scaffold leftover from the initial weather-MCP demo. The package's actual purpose is product-idea validation, not weather; the `weather` bin name is misleading.
**Impact:** Cosmetic only. Claude Desktop configs point at the absolute path of `build/index.js`, not the `bin` alias, so the leftover doesn't break anything in practice. But `npm install -g .` would install a `weather` command, which is wrong.
**Why deferred:** Renaming or removing `bin` is a `package.json` mutation that touches the publish surface; Phase 03 scope was strictly the HTTPS transport stack, so a `package.json` cleanup belongs in Phase 04 alongside other hygiene fixes.
**Suggested fix:** Phase 04 cleanup. Rename `bin.weather` → `bin.vetoed-mcp` (or remove entirely if not publishing to npm). Update `docs/HOSTED_SETUP.md` if the canonical local invocation changes.

### D-03-7 — Singleton `McpServer` cannot accept a second HTTP session

**Discovered during:** Phase 03 T-final-3b (HTTPS Fomi regression capture against live Fly deploy). The smoke opened one session and passed; a manual re-`initialize` against the same instance returned HTTP 500 `"Already connected to a transport"`.
**File:** `src/http/server.ts:128` (`mcpServer.connect(transport)` on the new-session branch); `src/index.ts:51` (singleton `new McpServer(...)`); `src/index.ts:129` (`createHttpServer(server)` hands over the singleton).
**Symptom:** The HTTP transport reuses one `McpServer` instance across sessions. The MCP SDK forbids connecting a single `McpServer` to >1 transport at a time, so the second `POST /mcp` initialize request 500s, and every subsequent session also 500s until the Fly instance is restarted.
**Impact:** Production-impact for the HTTP transport — bites the moment a second concurrent user appears OR the first user's Claude Desktop reconnects after a network blip. Masked in every Phase 03 artifact: `scripts/capture-fomi-via-https.ts` only opens one session; `scripts/assert-fomi-run.ts` (6/6 PASS) runs against a static JSON file and doesn't touch HTTP at all. Stdio path is unaffected.
**Why deferred:** Discovered post-PLAN-execute at T-final-3b; the Phase 03 merge gate (6/6 assert + 9/9 transport smokes) does not exercise the second-session path. The fix is small (factory extraction + http wire-up + redeploy verify ≈ 3 atomic commits) but requires its own PR so it can be reviewed against the byte-identical-stdio constraint without bundling unrelated work.
**Suggested fix:** Extract `createMcpServerInstance(): McpServer` from `src/index.ts:51-107` (singleton construction + 3 resources + 13 tools + 5 prompts) into `src/server/factory.ts`. Stdio mode calls the factory once at boot (preserves byte-identical behavior — `scripts/assert-fomi-run.ts` MUST still exit 0). Change `createHttpServer`'s signature to take a factory and call it inside the new-session branch before constructing the transport. Canonical pattern: `node_modules/@modelcontextprotocol/sdk/dist/esm/examples/server/jsonResponseStreamableHttp.js:92-93`. Add a vitest case opening two in-process sessions in series. Disposition: Phase 03.1 hotfix from `phase-v3-1-server-factory` (off `main` after Phase 03 merges), OR fold into Phase 04 iff no real users are onboarded first. Full disposition: `.planning/phases/03-multitenant-https/deferred-items.md` D-03-7.
**RESOLVED (Phase 04 follow-up, 2026-05-26):** Exported `createMcpServer(): McpServer` factory added to `src/index.ts` (3 resources + 13 tools + 5 prompts, same names + same registration order). Stdio mode calls it once at boot; HTTP mode passes the factory itself to `createHttpServer`. `createHttpServer(mcpServer: McpServer)` → `createHttpServer(getServer: () => McpServer)`; the initialize branch now builds `const session = getServer(); await session.connect(transport)` per session — mirrors the SDK example at `node_modules/@modelcontextprotocol/sdk/dist/esm/examples/server/jsonResponseStreamableHttp.js:8-92`. New regression test `src/http/server.test.ts` drives the contract via supertest: (a) initialize → 200 + capture mcp-session-id; (b) second initialize (no session id) → 200 with DIFFERENT session id; (c) tools/list on each → 13 tools each. Verification: `npm test` 136/136 across 15 files; `npm run smoke:http` SMOKE OK; `npm run build` clean. Full disposition + files-touched at `.planning/phases/03-multitenant-https/deferred-items.md` D-03-7.

---

*Concerns audit: 2026-05-20*
*Phase 03 deferred-items audit: 2026-05-26*
