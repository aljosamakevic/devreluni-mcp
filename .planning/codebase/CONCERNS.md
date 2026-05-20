# Codebase Concerns

**Analysis Date:** 2026-05-20
**Branch:** `research-v2`
**Scope:** TypeScript MCP server "ProductValidation MCP" — 21 source files in `src/`. Phase 1 + Phase 2 (steps 1-2) of `build_spec_v1.0.md` complete. Ordered by severity (HIGH → LOW).

---

## HIGH — Tool returns fake/noisy signal (violates spec §11 anti-pattern #1: "don't fabricate signal")

### H1. `find_pricing_anchors` price parser captures arbitrary numbers as prices

**Files:** `src/tools/find-pricing-anchors.ts:64-77`
**Symptoms:** Reported prices like "8217" and "474" appear in `tiers` and `current_pricing.price`. Examples seen in manual runs.
**Cause:** The regex on line 67-69 is over-permissive:
```ts
/(?:free|[\$€£¥]?\s*\d+(?:[.,]\d+)?(?:\s*\/\s*(?:mo(?:nth)?|yr|year|user|seat|month))?)/gi
```
- The currency prefix and the `/mo|/yr` suffix are both **optional**. Any bare number in the page text (HTML attribute leftover, image dimension, year, encoded entity `&#8217;`) matches.
- `stripHtml()` at `src/lib/webfetch.ts:29-43` decodes a few entities but leaves numeric entities (`&#8217;` → "8217") intact, which is exactly where "8217" comes from.
**Impact:** Pollutes `current_pricing.price`, breaks `category_pricing_pattern`, and produces nonsense `auto_flags` like "price dropping" based on garbage tiers. Per spec §11, this is **false-positive signal** — worse than no signal because downstream gates trust it.
**Fix approach:**
1. Make currency symbol *or* `/period` suffix mandatory in the regex (require at least one of `$€£¥` OR `/mo|/yr|/user|/seat|month|year`).
2. Decode numeric HTML entities (`&#\d+;`) to characters in `stripHtml()` before regex pass, or strip them entirely.
3. Drop bare-number matches < $1 or > $100,000 as guardrails.
4. Cap tier list length per page and dedupe case-insensitively.

### H2. `find_pricing_anchors` domain guessing fails ~50% of well-known apps

**Files:** `src/tools/find-pricing-anchors.ts:32-51` (`guessPricingUrl`, `extractDomain`)
**Symptoms:** Forest → guessed `forest.com` (actual `forestapp.cc`). Opal → guessed `opal.com` (actual `opal.so`).
**Cause:** Hard-coded `${slug}.com` assumption at line 37 and 50. No resolution step; no fallback to Serper-driven domain discovery.
**Impact:** Live-pricing fetch silently fails → falls through to Serper snippet text → triggers H1's noise regex on snippet HTML/text → polluted prices. Confidence note still claims "live pricing fetched" because the for-loop at line 135 just tries every PRICING_URL_PATHS against the wrong domain.
**Fix approach:**
1. Add a Serper "{name} official site" query first; take the top result's domain.
2. Cache `competitor → domain` mappings in `src/lib/cache.ts`.
3. If all fetch attempts fail, mark `model = 'unknown'` explicitly and skip price parsing rather than fall back to snippet parsing.

### H3. `find_pricing_anchors` cites Wayback URLs as sources without fetching them

**Files:** `src/tools/find-pricing-anchors.ts:151-159`
**Symptoms:** Every competitor gets a `https://web.archive.org/web/2024*/${domain}/pricing` source recorded with tier S / independent / `fetched_at: now`, but no HTTP request was ever made.
**Impact:** Direct violation of `ToolSource.fetched_at` semantics. Downstream prompts (validate_idea, line 151 of `src/prompts/validate-idea.ts` requires "Every DOK 1 fact has URL + tier + bias") treat this as a real fetched citation. **This is fabricated provenance** — spec §11 anti-pattern #1.
**Fix approach:** Either (a) actually call Wayback CDX API (`http://web.archive.org/cdx/search/cdx?url=…`) and record real snapshot URLs, or (b) downgrade the source to tier C with `fetched_at: null` and contribution "*pointer only — not fetched*". The `contribution` text "use to detect price changes" is misleading without (a).

### H4. `check_big_tech_encroachment` acquisition regex extracts article titles, not company names

**Files:** `src/tools/check-big-tech-encroachment.ts:234-240`
**Symptoms:** `target_company` field shows things like "Apple's Bold Plan to Reinvent Search" instead of an actual acquired company.
**Cause:**
```ts
const acqMatch = r.title.match(/acquir(?:es?|ed)\s+([A-Z][A-Za-z0-9.&\- ]+?)(?:\s+for|\s+in|[,.])/);
```
- Many headlines never contain the exact verb form `acquires/acquired` (use "buys", "snaps up", "takes over", "to acquire").
- When the regex misses, line 237 falls back to `r.title.slice(0, 60)` — guaranteed garbage.
- No deduplication of acquired companies across results.
**Impact:** Adjacency scoring at line 89-112 weights `acquisitions.length` directly. Garbage entries inflate the score artificially → false "Gate 3 FAIL likely" verdicts.
**Fix approach:**
1. Broaden verb set (`acqu|bought|buys|purchas|snapped up|to acquire`).
2. After regex extraction, validate the captured token against a small stoplist ("Plan", "Bold", "Search", "Way", "Future").
3. If no clean extraction, **skip the entry entirely** rather than recording a polluted one.

### H5. `check_big_tech_encroachment` misses obvious signals due to literal keyword match

**Files:** `src/tools/check-big-tech-encroachment.ts:138, 145-153`
**Symptoms:** Searching "focus app" returns zero WWDC mentions even though Apple Intelligence + Screen Time + Focus modes are heavily covered.
**Cause:** Query is `${category} site:${conf.site}` (line 146) — literal token match. Apple's docs use "Focus", "Screen Time", "Reduce Interruptions", "Apple Intelligence" — none of those match "focus app" as a phrase.
**Impact:** Generates **false negatives** on Gate 3, which is the most expensive kind of error in the spec's framework (lets a doomed idea pass moat-risk check).
**Fix approach:**
1. Expand each user-supplied keyword through a synonym map (`focus → focus mode | screen time | DND | concentration | deep work`).
2. Run multiple queries per conference and union the results.
3. Take `category_keywords` more seriously — currently they're just appended (line 138) with no separate query.

### H6. `check_big_tech_encroachment` recency detection is year-string-based and brittle

**Files:** `src/tools/check-big-tech-encroachment.ts:75-83`
**Symptoms:** Pages without an explicit year in title/snippet (most evergreen developer.apple.com docs) → `recency_signal: 'unknown'` → excluded from scoring at line 90.
**Impact:** Real platform encroachment signals on docs pages get filtered out (line 283 only returns `last_24mo`). Score inflated toward "no signal".
**Fix approach:** Use Serper's `tbs=qdr:y2` (past 2 years) filter at the query level, or accept `unknown` recency at half-weight in `scoreAdjacency`.

### H7. `scan_producthunt_launches` returns empty for "focus app" despite live products

**Files:** `src/tools/scan-producthunt-launches.ts:55-78`, `src/lib/producthunt.ts:18-92`
**Symptoms:** Query "focus app" returns zero launches even though Forest, Opal, Cold Turkey, Brick, etc. all launched on PH.
**Cause candidates:**
1. GraphQL `posts(search: $query, …)` is a phrase match on PH's side — splitting "focus app" finds nothing relevant.
2. `order: VOTES` sorting + no date range → returns ancient launches that may not match newer ranking.
3. The `date_range` argument in the tool schema (line 47-52) is accepted but **never passed to the API** — silently dropped. This is spec §11 anti-pattern #2: "tool accepts argument it ignores."
**Impact:** Empty PH results bias `find_closest_competitor` recommendation at `src/tools/find-closest-competitor.ts:80-88` toward "nascent market" (false positive on opportunity).
**Fix approach:**
1. Pass `date_range` through to the GraphQL query (`postedAfter`, `postedBefore`).
2. Try multiple query variants (raw category, single tokens, topic-slug match).
3. Add PH `topic` filter when category maps to a known PH topic.

### H8. Spec §11 critical-test has never been executed

**Files:** N/A — process gap. Spec referenced in your prompt at `build_spec_v1.0.md §11`.
**Symptoms:** The "cheapest end-to-end quality check the spec defines" — re-validating Aljosa's AI focus app idea through `validate_idea` and verifying a sound NO-GO — has not been run on `research-v2`.
**Impact:** All H1-H7 bugs are individually visible, but their **combined effect on a real gated verdict is unknown**. Could produce a false GO/CONDITIONAL GO on an idea the spec explicitly expects to fail.
**Fix approach:** Run the test before declaring Phase 2 done. Capture the report. Diff verdicts against the spec's expected outcome. Treat any disagreement as a P0 bug.

---

## HIGH — Missing P0/P1 tools from spec §7

### H9. P0 tools unbuilt — gates G5 and G2 have no primary tool

**Files:** Not present in `src/tools/`.
**Missing:**
- `find_why_now_signals` (P0) — Gate 5 (Why Now) has no primary tool. The prompt at `src/prompts/validate-idea.ts:71` still asks the model to evaluate Gate 5, but nothing fetches the underlying signals (Gartner hype cycle position, regulatory shifts, platform-API release timing). Verdict will be DOK-3 vibes only — spec §11 anti-pattern #6: "verdicts not grounded in DOK 1 facts."
- `estimate_demand_signals` (P0) — Gate 2 (Market Demand) leans on `find_closest_competitor`'s `hn_mentions` and `ph_launches` counts (lines 77-78) as proxies. These are weak demand signals. Without keyword volume / trend / search-intent data, Gate 2 PASS thresholds (spec §11: "PASS requires ≥2 tier-B-or-higher sources") will be hard to hit.

### H10. P1 tools unbuilt

- `find_public_revenue_signals` (P1) — Gate 4 (WTP) currently relies on `find_pricing_anchors` only. Without revenue data (Stripe Atlas, Indie Hackers MRR, public SaaS metrics), WTP is inferred from list-price scrape — already broken per H1/H2.
- `assess_platform_dependency` (P1) — Referenced in `check_big_tech_encroachment.ts:276` ("Still verify with assess_platform_dependency for ToS/integration risks") but the tool **does not exist**. The verdict promises a follow-up tool the user cannot call. Spec §11 anti-pattern #2.

**Fix approach:** Build per spec §7 ordering. Until then, document in the validate-idea prompt that these gates run with degraded inputs.

---

## MEDIUM — Spec §11 anti-pattern audit (creeping in)

### M1. Silent fallback to stub data — anti-pattern #3 "default unknown bias to independent"

**Files:** `src/lib/serper.ts:39-43`, `src/lib/producthunt.ts:55-57, 89-91`.
**Symptoms:** When live fetch fails (network, 429, malformed JSON), the libs return `getSerperStub()` / `getPHStub()` results. The `fallbacks_used` array is populated **only when API key is absent**, not when the live call errored.
**Impact:** A failed live call is indistinguishable from a successful one in `ToolResult.sources`. Downstream prompt treats stubbed data as live tier-A. Direct anti-pattern #1 ("fabricate signal") + #3 ("hide low-confidence data").
**Fix approach:** Push the failure into `fallbacks_used` from inside the library (e.g., return `{ results, fallback?: string }`). Or throw and let the tool catch — but never silently return stubs that look real.

### M2. `serperSource` lies about bias when stubbed

**Files:** `src/lib/serper.ts:66-77`
**Symptoms:** When `isSerperLive()` is false, `bias` defaults to `'unknown'` (line 71). That's correct. But `tier` is `'D'` — fine — yet the source URL still points to `google.serper.dev/…` as if it had been queried. Misleading provenance.
**Impact:** Lower severity than M1, but compounds it. A reader scanning sources sees a "google search URL" and assumes it was run.
**Fix approach:** When stubbed, prefix `url` with `[STUB] ` or use a `stub:` URI scheme.

### M3. `check_big_tech_encroachment` swallows all per-query errors silently

**Files:** `src/tools/check-big-tech-encroachment.ts:147-153, 209-211, 249-251`
**Symptoms:** Three `try { … } catch {}` blocks swallow exceptions with comments like "graceful degradation per spec — never fail silently, but never throw" — yet **they do fail silently** (no log, no fallback record).
**Impact:** A bad API key, rate limit, or network error → empty result arrays → adjacency score 1/5 ("No clear encroachment signal") → false PASS on Gate 3.
**Fix approach:** Log to `console.error` with query context, and push a `fallbacks_used` entry. The spec wants graceful degradation that is **visible**, not invisible.

### M4. `find_closest_competitor` recommendation flips on stub data

**Files:** `src/tools/find-closest-competitor.ts:80-88`
**Symptoms:** If Serper returns 0 results (stub or live failure), branch at line 81 fires "nascent market (opportunity)" recommendation. With H7, this is reachable when PH also stubs.
**Impact:** False-positive opportunity signal when the truth is "we have no data." Spec §11 anti-pattern #3.
**Fix approach:** Gate the "nascent market" branch on `isSerperLive() && fallbacks_used.length === 0`. Otherwise return "insufficient data — re-run with credentials."

### M5. `extractChurnLanguage` regex over-matches and under-attributes

**Files:** `src/tools/find-pricing-anchors.ts:79-97`
**Symptoms:** Pattern `/refund[^.]*\./gi` captures any sentence containing "refund" — including "30-day refund policy" (positive signal) recorded as a churn signal. No attribution to which product/review the quote came from.
**Impact:** Inflated `churn_signals` count → triggers "high churn language" auto-flag (line 255) on benign category pages. Quotes can't be cited back per validate-idea's DOK 1 requirement.
**Fix approach:** Add a polarity check (require co-occurrence with negative qualifier within 50 chars), attach `source_url` to each signal, and surface the result as `{quote, url}` not bare strings.

---

## MEDIUM — Architecture / coverage gaps

### M6. Reddit refactor dropped tier A → B with no replacement

**Files:** `src/lib/reddit.ts:1-104`
**Symptoms:** Refactor away from Reddit OAuth → Serper `site:reddit.com`. Documented honestly in the header comment (lines 1-15) and in `redditConfidenceNote()`. **But**:
- Score, comment count, created_utc, author = 0 / 'unknown' (lines 73-76). Posts have no engagement weight.
- Gate 2 (Market Demand) had Reddit as a tier-A primary source per spec §7; now it's tier B.
- No fallback to PRAW / Pushshift / official Reddit JSON endpoint (`reddit.com/r/x.json` is public).
**Impact:** Documented downgrade is fine in isolation, but combined with H9 (`estimate_demand_signals` missing) Gate 2 is now seriously under-served.
**Fix approach:** Either (a) add Reddit public JSON as a tier-A path when the post URL is known from Serper, fetching score/comments from `${url}.json`, or (b) accept tier B and ship `estimate_demand_signals` faster.

### M7. No automated tests

**Files:** `package.json:11` — `"test": "echo \"Error: no test specified\" && exit 1"`.
**Symptoms:** Zero unit tests, zero integration tests. Validation is manual via Claude Desktop tool calls.
**Impact:**
- Regex bugs like H1, H4 are exactly the class of issue unit tests would catch in seconds.
- Refactors are risky — no safety net.
- The spec §11 critical test (H8) is itself a manual smoke test.
**Fix approach:**
1. Add `vitest` + a `test/` directory.
2. First targets: regex helpers (`extractPriceTiers`, acquisition regex, `detectRecency`, `extractChurnLanguage`) — pure functions, easy to fixture.
3. Then HTTP-mocked integration tests for each tool with recorded fixtures.

### M8. Build/deployment surface is narrow

**Files:** `src/index.ts:98-107`, `package.json:7-9`
**Symptoms:**
- Only stdio transport (`StdioServerTransport`, line 99). No HTTP / SSE mode.
- Only tested in Claude Desktop. No standalone CLI mode for offline debugging.
- `package.json:8` still has `"bin": { "weather": "./build/index.js" }` — leftover from the original weather MCP scaffold. Wrong name (`weather`, not `product-validation`).
**Impact:**
- Cannot share with non-Claude-Desktop users.
- Cannot drive tools from a test script without launching the full MCP handshake.
- Wrong bin name breaks `npx`-style usage.
**Fix approach:** (a) Add `--cli` flag that bypasses transport and dispatches a single tool by name + JSON args. (b) Add HTTP transport behind `--http` for hosted deployment. (c) Rename `bin.weather` to `bin.product-validation`.

### M9. Resource files loaded fresh per request but no version stamping

**Files:** `src/index.ts:41-43, 51-79`
**Symptoms:** `loadResource()` reads `src/resources/*.md` from disk on every invocation. Good for freshness, but no checksum / version logged with the tool result.
**Impact:** When the resource changes between gate calls in the same `validate_idea` run, two gates may operate on different rule sets. Subtle but possible.
**Fix approach:** Hash the resource at load time; include hash in `confidence_note` of any tool that depends on it (currently none do, but the gate prompts do).

---

## LOW — Hygiene

### L1. Stale branches

**Files:** Git only.
**Branches present:** `weather-mcp`, `research-v1`, `research-v2` (current), plus three `claude/*` worktree branches (`pensive-newton-2f202f`, `priceless-haslett-797a93`, `silly-mccarthy-051014`).
**Impact:** No active harm, but `weather-mcp` is from the prior scaffold and `research-v1` is superseded. Confuses new contributors.
**Fix approach:** After H8 critical test passes on `research-v2`, merge to `main` and delete `weather-mcp`, `research-v1`, and any closed `claude/*` worktree branches.

### L2. `package.json` metadata still says "weather"

**Files:** `package.json:8`
- `bin.weather` → should be `product-validation`.
- `description: ""` is empty.
- `keywords: []` empty.
- `author: ""` empty.
**Impact:** Cosmetic, but the MCP server identifies itself as `product-validation` (`src/index.ts:46`) — the package.json mismatch will bite the first time someone installs via npm.
**Fix approach:** Set `name`, `description`, `bin`, `author`, `keywords` consistently.

### L3. `tsconfig` and dependency version drift

**Files:** `package.json:30-34`
**Symptoms:**
- `typescript: ^6.0.3` — TypeScript 6 is bleeding-edge; some downstream tooling may not support it.
- `@types/node: ^25.7.0` — pinned to Node 25 types while runtime requirements aren't documented.
- `dotenv: ^17.4.2` — v17 changed stdout behavior (`quiet: true` is already worked around in `src/index.ts:13`); pin precisely.
**Impact:** Build can break across machines.
**Fix approach:** Add `engines.node` to `package.json`. Pin TS to a stable major. Add `.nvmrc`.

### L4. `console.error` for runtime info on stdio transport

**Files:** `src/index.ts:101-106`, `src/lib/serper.ts:40`
**Symptoms:** stderr logging is fine for stdio MCP (only stdout is JSON-RPC), but the messages are unstructured and mix startup info with error info.
**Impact:** Hard to grep / monitor in production.
**Fix approach:** Structured logging via a tiny logger module (level + JSON). Not urgent.

### L5. `.env` loading path assumes specific directory layout

**Files:** `src/index.ts:13-16`
**Symptoms:** `join(dirname(fileURLToPath(import.meta.url)), '..', '.env')` — works for `build/index.js` and `src/index.ts` (tsx) but breaks if file is symlinked or bundled.
**Impact:** Low — current invocation paths are limited.
**Fix approach:** Walk up to find `.env` next to `package.json`, or accept `--env-file` flag.

---

## Test Coverage Gaps

### TC1. Regex helpers — zero tests

**Files to fixture:**
- `extractPriceTiers` (`src/tools/find-pricing-anchors.ts:64`) — feed it pages with and without prices, with numeric HTML entities, with currency, without.
- `detectPricingModel` (line 53) — overlap cases (freemium AND subscription).
- `extractChurnLanguage` (line 79) — positive uses of "refund".
- `detectRecency` (`src/tools/check-big-tech-encroachment.ts:75`) — dateless pages, multi-year pages.
- Acquisition regex (line 234) — known good and known bad titles.

### TC2. Tool integration tests — none

Each tool's full output shape (`ToolResult<T>`) is unverified. Schemas could drift from the prompt's expectations silently.

### TC3. Prompt rendering tests — none

`validate-idea.ts` is 200 lines of templated text. Typos / broken `${}` interpolations would only surface at runtime.

---

## Cross-Cutting Risk Summary

The dominant risk pattern: **the server quietly returns plausible-looking but wrong data**, which directly violates the spec's anti-fabrication stance (§11). H1+H2+H3+H7+M1+M2+M3+M4 are all variants of "we returned a result that *looks* tier-A live but isn't." Fixing the silent-fallback path (M1/M2) is leverage — it lights up most of the H-tier symptoms downstream.

The second-largest risk: **gates evaluating on missing tools** (H9, H10). The validate-idea prompt asks for DOK-1 evidence per gate; with G2/G4/G5 primary tools missing, the model fills the gap with judgment and ships it as data. Anti-pattern #6.

**Suggested ordering of work:**
1. Run H8 (critical test) on current code — capture baseline failure modes.
2. Fix M1/M2 (silent fallback visibility) — cheapest, highest fan-out.
3. Fix H1 (price regex) and H2 (domain guessing) — restores pricing tool to honest.
4. Fix H3 (Wayback fake-source) — provenance integrity.
5. Build H9 tools (`find_why_now_signals`, `estimate_demand_signals`) — closes gate coverage.
6. Re-run H8 — compare verdicts.
7. Address M7 (tests) before further tool work.

---

*Concerns audit: 2026-05-20*
