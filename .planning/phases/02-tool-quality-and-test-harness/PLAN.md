# Phase 02 — Tool Quality + Test Harness

> **Author:** GSD planner, 2026-05-25 (v0.2)
> **Spec basis:** `.planning/spec/build-spec-v1.0.md` v1.0 (§4 source tier system, §11 DoD + 6 anti-patterns)
> **Concerns basis:** `.planning/codebase/CONCERNS.md` — closes M1–M9, plus inherited D-01 / D-T04-2 / D-T16-1
> **Style template:** `.planning/phases/01-anti-bias-hardening/PLAN.md`

---

## Phase Goal

Close the 9 MEDIUM concerns (M1–M9), the three Phase-01 deferred items (D-01, D-T04-2, D-T16-1), and bootstrap a Vitest test harness (L1) targeting the parsers most likely to drift. Phase 01 made the anti-bias guarantees structurally enforced (validator + renderer + JSON pipeline). Phase 02 makes the **signal-emitting tools accurate enough that those guarantees have real material to validate**.

**Tie to spec:**
- §11 sound-reasoning test ("A source URL that actually exists and contains the claimed information; a tier badge consistent with the source type; a bias flag consistent with the source's funding/affiliation") — drives Streams A, B, C, D. M1/M2/M4/M6 break clause 1; D-T04-2 breaks clause 3.
- §4 rule 6 ("`conflicted` competitor sources are valid only as positioning evidence") — D-T04-2 enforcement. Competitor-authored / `site:<competitor>` content is `conflicted`, never `independent`.
- §4 rule 1 (PASS requires ≥2 tier-B-or-higher sources) — depends on tier labels being correct, which depends on M1/M2/M4 not poisoning the appendix.
- §11 DoD tool-call budget (<20) — drives Stream E (M8 cache wiring).
- §11 anti-pattern 2 ("Soft-failing tool calls — returning made-up data when the API fails") — M1/M4/M6 are residual instances.

**Inviolate constraints (carried from Phase 01):**
- After Phase 02, `npx tsx scripts/assert-fomi-run.ts` MUST still exit 0 (6/6 PASS). Every Stream A–E task must respect this gate; T-final re-runs it (against BOTH the captured Phase-01 artifact AND a freshly re-executed Phase-02 artifact — see T-final-2 + T-final-3).
- Tool count stays at 13 (12 spec tools + `finalize_validation_report`). No new tools added; existing ones tightened.

---

## Goal-Backward Verification

Each CONTEXT.md success-criterion row maps to specific tasks below. If any row's tasks all pass and the criterion is still untrue, the plan has a gap.

| Success criterion (CONTEXT.md §"Success criteria") | Producing task(s) |
|---|---|
| M1: `find_pricing_anchors` regex requires currency anchor; no `"8217"` / `"474"` artifacts in `tiers[]` | **T01** (Stream A) + **T-V03** (Stream F parser test) |
| M2 + D-01: domain resolution via Serper top-result hostname; Forest/Freedom/Opal/Cold Turkey/Rize resolve correctly | **T02** (Stream A) |
| M9: `confidence_note` reports actual per-competitor `fetchedSuccessfully` count | **T03** (Stream A) |
| M3: Wayback URL handling (already addressed in Phase 01 H8 via `lib/wayback.ts`); verified closed | **T04** (Stream A — verify-and-close, no code change unless audit fails) |
| M4: acquisition regex requires end-anchor; on no-match, entry dropped (no headline fallback) | **T05** (Stream B) + **T-V05** (Stream F) |
| M5: each hyperscaler search expanded via category→platform-feature synonym map | **T06** (Stream B) — new `lib/category-platform-features.ts` |
| M6: `scan_producthunt_launches` resolves topics; either ≥1 result for "focus app" OR honest `confidence_note` | **T07** (Stream C — `producthunt.ts` topics API resolution) + **T08** (Stream C — tool wiring) |
| D-T04-2: Serper `site:<competitor>` source + competitor-authored HTML changelog tagged `bias: 'conflicted'` | **T09** (Stream D) |
| D-T16-1: `platform-keywords.ts` longest-trigger-first OR aliases-then-fallback resolution | **T10** (Stream D) + **T-V07** (Stream F) |
| M8: `cache.ts` integrated into ≥5 tool entry points; cached-hit-on-repeated-query confirmed | **T11** (Stream E — cache audit + design) + **T12** (Stream E — wire orchestration tools) + **T-V08** (Stream F cache test) |
| L1: Vitest installed; `npm run test` passes; ≥10 parser unit tests + 1 renderer snapshot test | **T-V01** (harness setup) + **T-V02 through T-V08** (parser tests) + **T-V09** (renderer snapshot) |
| CONCERNS M1–M9 + D-01/D-T04-2/D-T16-1 marked RESOLVED with commit references | **T-final-1** (CONCERNS.md update) |
| `scripts/assert-fomi-run.ts` still exits 0 after all fixes (against CAPTURED Phase-01 artifact) | **T-final-2** (artifact-level regression check) |
| `validate_idea` re-executed end-to-end against Fomi case STILL returns NO-GO with 6/6 PASS | **T-final-3** (fresh end-to-end LLM rerun + capture + assert) |

---

## Task Breakdown

**Total:** 20 tasks across 6 streams. Each task = one atomic commit.

Complexity legend (same as Phase 01): **S** = ≤1h, single file edit, no new external dep. **M** = 1–3h, multi-file or new internal module. **L** = 3–6h, new external integration / parser work / cross-cutting wiring.

---

### Stream A — Parser/heuristic fixes in `find_pricing_anchors`

All four items touch one file (`src/tools/find-pricing-anchors.ts`) plus one new dependency (`lib/wayback.ts` resolution paths for D-01). Bundled here to minimize merge conflicts and let one executor own the file end-to-end.

#### T01 — Tighten `extractPriceTiers` to require a currency anchor (M1)
- **Goal:** Replace the current regex at `find-pricing-anchors.ts:66-79` with a currency-anchored pattern. Free tier is parsed separately and emitted as a sentinel string `'Free'` (not via the price regex). HTML noise like `"8217"` (from `&#8217;`) and `"474"` (CSS class fragments) no longer reaches `tiers[]`.
- **Files:** `src/tools/find-pricing-anchors.ts` (lines 66-79, ~15 lines net change)
- **Spec refs:** §11 anti-pattern 2 (no made-up data); §11 sound-reasoning test clause 1.
- **Acceptance:**
  - Regex: `/[\$€£¥]\s*\d+(?:[.,]\d+)?(?:\s*\/\s*(?:mo|month|yr|year|user|seat))?/gi` (per CONCERNS.md starting point).
  - Free tier handled via separate scan: `/\b(free|free plan|free tier|free forever)\b/i` — if match, prepend `'Free'` to `tiers[]`.
  - `grep -nE "matchAll\(\s*\/.*\$\\\\d" src/tools/find-pricing-anchors.ts` returns the new currency-anchored regex; no naked `\d+` fallback remains.
  - Unit fixture (created by **T-V03**) feeds three HTML-noise strings (`"copyright &#8217; 2024"`, `class="col-474"`, `"buy now for $39/mo"`) and asserts only `'$39/mo'` extracted.
- **Dependencies:** none
- **Complexity:** S

#### T02 — Resolve competitor domain via Serper top-result (M2 + D-01)
- **Goal:** Replace `extractDomain` (line 43-53) and `guessPricingUrl` (line 34-41) — both brittle. New helper `resolveCompetitorPricingUrl(competitor, fallbacksUsed): Promise<{ domain: string; pricingUrl: string }>` flows:
  1. If `competitor.startsWith('http')` — parse hostname directly; canonicalize via `getCanonicalHost` (handles `www.` ↔ apex).
  2. Else: `serperSearch(\`${competitor} pricing\`, 1)`. Take top organic hit's `link`. Extract hostname.
  3. If Serper returns nothing or stub: fall back to the old `${slug}.com` heuristic AND push `'serper-domain-resolution (fallback to .com guess)'` to `fallbacksUsed`.
  4. Cache the mapping `competitor → resolved hostname` via `cacheGet/cacheSet` with `TTL.LONG` (this mapping is stable across runs). Key: `makeCacheKey('domain-resolve', competitor)`.
  5. The returned `pricingUrl` is `https://<resolved-host>/pricing`. The probing loop at lines 140-155 keeps trying the `PRICING_URL_PATHS` variants as before, BUT both the resolved hostname AND its `www.`-prefixed sibling are added to the probe list (closes D-01: the `www.` stripping issue documented in `deferred-items.md`).
- **Files:** `src/tools/find-pricing-anchors.ts` (replace 32-53 + adjust loop 140-155, ~50 lines net change)
- **Spec refs:** §11 sound-reasoning clause 1; CONCERNS.md M2; deferred-items.md D-01.
- **Acceptance:**
  - With `SERPER_API_KEY` set, `resolveCompetitorPricingUrl('Forest')` returns `forestapp.cc` (top Google hit for `"Forest pricing"`).
  - `resolveCompetitorPricingUrl('Freedom')` returns `freedom.to`.
  - With no key, falls back to `freedom.com` AND records the fallback in `fallbacksUsed`.
  - Cache: calling twice in one process for the same competitor results in 1 Serper call, not 2 (verified by **T-V08**).
  - Probe loop includes both `freedom.to/pricing` and `www.freedom.to/pricing` — `grep -n "www\\." src/tools/find-pricing-anchors.ts` returns ≥1 match in the new probe-list construction.
- **Dependencies:** T01 (sequential file edit)
- **Complexity:** M

#### T03 — Per-competitor `fetchedSuccessfully` counter for `confidence_note` (M9)
- **Goal:** Replace the broken aggregate at lines 298-309. The `fetchedSuccessfully` boolean already exists per-competitor inside the loop (line 136); promote it to a counter `liveFetchCount` incremented when `fetchedSuccessfully` flips true. Use that counter directly in `confidenceParts[0]` — not the `.filter(...).length` over the global `sources` array (which double-counts).
- **Files:** `src/tools/find-pricing-anchors.ts` (lines 124-130 add `let liveFetchCount = 0;`; loop body line 144 increment; lines 298-309 replace `fetchedCount` math)
- **Spec refs:** §11 sound-reasoning clause 1 (audit trail must be accurate); CONCERNS.md M9.
- **Acceptance:**
  - For 4 competitors where 1 has a fetchable pricing page: `confidence_note` includes the substring `1 of 4 fetched live` (or equivalent — exact phrasing flexible, but the numerator MUST be 1, not 4).
  - `grep -n "sources\.some" src/tools/find-pricing-anchors.ts` no longer appears in the `fetchedCount` calculation.
- **Dependencies:** T02 (sequential file edit)
- **Complexity:** S

#### T04 — Verify M3 closed; no code change unless audit fails
- **Goal:** Confirm the H8 Phase 01 fix fully eliminated the Wayback fabrication path. Audit: `grep -nE "web\.archive\.org/web/[^0-9]" src/tools/find-pricing-anchors.ts` MUST return zero matches. If audit passes, edit CONCERNS.md M3 to add `**Verified closed by Phase 02 T04 (covered by Phase 01 H8 fix)**` (no date — Phase 02 didn't reopen this). If audit fails, file a follow-up task `T04-followup` and treat T04 as IN PROGRESS.
- **Files:** `.planning/codebase/CONCERNS.md` (M3 annotation only — no code change expected)
- **Spec refs:** §11 anti-pattern 2; CONCERNS.md M3.
- **Acceptance:**
  - Grep audit recorded in commit message.
  - CONCERNS.md M3 annotated as verified-closed (or follow-up filed).
- **Dependencies:** T03 (so all Stream A `find-pricing-anchors.ts` edits ship before audit)
- **Complexity:** S

---

### Stream B — `check_big_tech_encroachment` hardening (M4 + M5)

#### T05 — Tighten acquisition regex; drop entries on fallthrough (M4)
- **Goal:** Replace the regex at `check-big-tech-encroachment.ts:234` with an end-anchored pattern. On no-match, `continue` the loop — do NOT fall back to `r.title.slice(0, 60)` (line 237). Better to drop a real acquisition than fabricate one from a headline fragment.
- **Files:** `src/tools/check-big-tech-encroachment.ts` (lines 234-240, ~15 lines net change)
- **Spec refs:** §11 anti-pattern 2 ("returning made-up data when the API fails" — the headline fallback is exactly this); CONCERNS.md M4.
- **Acceptance:**
  - New regex requires explicit end-anchor: `/acquir(?:es?|ed)\s+([A-Z][A-Za-z0-9.&\-]+(?:\s+[A-Z][A-Za-z0-9.&\-]+){0,2})\s+(?:for\s+\$|in\s+a\s+\$|deal)/`.
  - On no-match: `continue` (no `acquisitions.push(...)` call).
  - `grep -n "r\.title\.slice(0, 60)" src/tools/check-big-tech-encroachment.ts` returns zero matches.
  - Unit fixture (created by **T-V05**) feeds 10 real-shape TechCrunch headlines (5 positive — "Apple acquires Pixelmator for $200M", "Google acquired Looker in a $2.6B deal" — and 5 negative — "Apple's strategy after acquiring Pixelmator hints at...") plus 4 NEGATIVE fixtures locking the false-negative trade-off (see T-V05 Warning 4 addition).
- **Dependencies:** none
- **Complexity:** S

#### T06 — Category → platform-feature synonym map (M5)
- **Goal:** New `src/lib/category-platform-features.ts` exporting a static map from category keywords to platform-feature names. Each hyperscaler search in `check-big-tech-encroachment.ts` then fans out one base query plus one per matched feature. Map shape:
  ```
  Map<categoryKeyword, { apple: string[]; google: string[]; microsoft: string[] }>
  ```
  Seeded entries (CONTEXT.md §M5 examples):
  - `"focus app"` / `"deep work"` → apple: `["Apple Intelligence", "Screen Time", "Focus Modes", "Do Not Disturb"]`; google: `["Digital Wellbeing", "Focus Mode Android"]`; microsoft: `["Focus Sessions Windows 11", "Viva Insights focus"]`.
  - `"writing assistant"` / `"ai writing"` → apple: `["Apple Intelligence Writing Tools", "Smart Reply"]`; google: `["Help me write Gmail", "Smart Compose"]`; microsoft: `["Copilot in Word", "Editor Microsoft"]`.
  - `"calendar ai"` / `"scheduling assistant"` → apple: `["Siri scheduling", "Calendar Suggestions iOS"]`; google: `["Gemini in Calendar", "Reclaim Google Calendar AI"]`; microsoft: `["Copilot in Outlook", "Microsoft Scheduler"]`.
  - `"note taking"` → apple: `["Apple Notes", "Genmoji Notes"]`; google: `["Google Keep AI", "NotebookLM"]`; microsoft: `["OneNote Copilot", "Loop Microsoft"]`.

  Wire into `check-big-tech-encroachment.ts`: a new helper `expandHyperscalerQueries(category, keywords): { apple: string[]; google: string[]; microsoft: string[] }` runs at the top of the handler. The Phase-2-conference-search loop (line 145) and Phase-2-API-query loop (line 188) consume the expanded query list; each becomes `baseQuery + " " + featureName`. Hard cap: 3 extra feature queries per hyperscaler per phase to bound tool calls (Risk R-budget below).
- **Files:** `src/lib/category-platform-features.ts` (new, ~80 lines); `src/tools/check-big-tech-encroachment.ts` (wire into both query phases, ~40 lines net change)
- **Spec refs:** §11 DoD ("validate_idea on the AI-native focus app idea returns NO-GO with sound reasoning" — Gate 3 must surface Apple Intelligence / Screen Time); CONCERNS.md M5; spec §4 source tiers (the new queries return tier-S/conflicted entries, identical to existing conference results).
- **Acceptance:**
  - Map exists with at least 4 category entries.
  - `expandHyperscalerQueries('focus app', ['deep work'])` returns ≥3 Apple features including all of `"Apple Intelligence"`, `"Screen Time"`, `"Focus Modes"`.
  - Hyperscaler search loop fires ≤ `HYPERSCALER_CONFERENCES.length * (1 + 3)` Serper queries total — bounded.
  - **Delta check (load-bearing, per PLAN-CHECK warning 3):** invoke `check_big_tech_encroachment` with `{ category: 'focus app', category_keywords: ['screen time', 'deep work'] }` BEFORE the synonym map is wired (capture `sources.length` as `before_count`), then AFTER (capture as `after_count`). Assert `after_count > before_count` AND assert that at least one new source's URL contains one of the synonym-map keywords (`Apple Intelligence`, `Screen Time API`, `Focus Modes`, or `Digital Wellbeing`). If `after_count == before_count`, the map is not firing — investigate before committing. Capture both counts in the commit message.
  - **T-final-3** (Fomi end-to-end rerun) shows ≥1 Gate 3 DOK 1 fact mentioning Apple Intelligence OR Screen Time OR Focus Modes OR Digital Wellbeing.
- **Dependencies:** T05 (sequential file edit on `check-big-tech-encroachment.ts`)
- **Complexity:** L (elevated from M — the delta check + dual-phase wiring + measurable-fire requirement pushes this into 3–5h territory)

---

### Stream C — Product Hunt empty-results fix (M6)

#### T07 — Add PH topics API resolution in `lib/producthunt.ts`
- **Goal:** Add `resolvePHTopic(category: string): Promise<{ slug: string; name: string } | null>` and `postsByTopic(topicSlug: string, first: number): Promise<PHPost[]>` to `src/lib/producthunt.ts`. Flow:
  1. PH Topics search GraphQL: `query { topics(query: $q, first: 5) { edges { node { slug name followersCount } } } }`. Return the top match by `followersCount` desc, or null if no edges.
  2. Posts-by-topic: `query { topic(slug: $slug) { posts(first: $first, order: VOTES) { edges { node { ...same fields as searchProductHunt... } } } }`.
  3. Both helpers gracefully degrade when `PRODUCTHUNT_API_KEY` absent (return null / `[]` and log to caller via boolean return shape, identical to existing `searchProductHunt` stub pattern).
- **Files:** `src/lib/producthunt.ts` (extend, ~80 lines added)
- **Spec refs:** §7 graceful degradation contract; CONCERNS.md M6.
- **Acceptance:**
  - With `PRODUCTHUNT_API_KEY` set, `resolvePHTopic('focus app')` returns a non-null slug (verified by smoke call).
  - Without key, returns null and logs via existing stub pattern.
  - `postsByTopic('productivity', 5)` returns up to 5 posts with non-zero `votesCount` when key is set.
  - **Fallback acceptance (per PLAN-CHECK warning 6):** if the PH GraphQL `topics(...)` query returns a 'not authorized' or 'unknown field' error, the task is still considered complete IF:
    (a) the error is caught and logged downstream in `scan_producthunt_launches`'s `confidence_note` as `'PH topics API unavailable — falling back to query-based search'`;
    (b) the existing `searchProductHunt(query, first)` query-by-string path is preserved and still works (T07 must not break it);
    (c) a `D-XX` entry is added to `.planning/phases/01-anti-bias-hardening/deferred-items.md` describing the API limitation (auth scope, error shape observed, what's needed to unlock — Pro tier? OAuth scope upgrade?).
    The fallback path satisfies M6's spec §11 anti-pattern 2 compliance (don't fail silently — the gap is surfaced to the user).
- **Dependencies:** none
- **Complexity:** M

#### T08 — Wire topic resolution into `scan_producthunt_launches` tool
- **Goal:** Rework `src/tools/scan-producthunt-launches.ts:55-104` to:
  1. Call `resolvePHTopic(category)` first.
  2. If topic resolved: call `postsByTopic(slug, 15)`.
  3. If topic resolved but posts empty: append `"PH topic '${slug}' returned 0 posts"` to `confidence_note`.
  4. If topic resolution returned null OR threw a known-API-shape error: fall back to `searchProductHunt(category, 15)` (existing behavior) AND append `"PH topic resolution returned 0 matches for category '${category}' — falling back to search"` (or the API-unavailable variant from T07) to `confidence_note`.
  5. Under no circumstance return `launches: []` with a generic confidence note. The honest gap MUST be surfaced explicitly.
- **Files:** `src/tools/scan-producthunt-launches.ts` (lines 55-104, ~40 lines net change)
- **Spec refs:** §11 anti-pattern 2 (no silent failures); CONCERNS.md M6.
- **Acceptance:**
  - Smoke test: invoking the tool with `category: "focus app"` returns EITHER ≥1 launch OR a `confidence_note` containing the substring `"topic"` and `"0"` (the honest-gap-logged path).
  - `grep -n "resolvePHTopic" src/tools/scan-producthunt-launches.ts` returns ≥1 match.
- **Dependencies:** T07
- **Complexity:** S

---

### Stream D — Source bias mislabeling cleanup

Both fixes are 1-line-class edits but touch correctness, not style. Each gets a focused commit so the bias-flip audit trail is grep-able.

#### T09 — Flip `independent` → `conflicted` on competitor-authored / `site:<competitor>` sources (D-T04-2)
- **Goal:** Two edits in `src/tools/read-competitor-changelog.ts`:
  - **Line 187:** Wayback Machine source registered immediately after fetching the competitor-authored changelog HTML. Currently `bias: 'independent'`. Per spec §4 rule 6, content authored by the competitor (even if archived by an independent third party) carries the bias of the AUTHOR, not the host. Change to `bias: 'conflicted'`. Contribution text updated to reflect this: `"Wayback Machine snapshot of competitor-authored changelog — content is conflicted (competitor's words), URL is independent"`.
  - **Line 222:** Serper search snippet returned with `bias: 'independent'`. This snippet was retrieved via `site:<competitor>` filter (Step 1 of the fetch loop), meaning the underlying CONTENT is the competitor's own page text indexed by Google. Per spec §4 rule 6: `conflicted`. Change `bias: 'independent'` → `bias: 'conflicted'`.
- **Files:** `src/tools/read-competitor-changelog.ts` (lines 187 + 222, ~6 lines net change including contribution text)
- **Spec refs:** §4 rule 6 ("`conflicted` competitor sources are valid only as positioning evidence"); §11 sound-reasoning clause 3 (bias flag consistent with funding/affiliation); deferred-items.md D-T04-2.
- **Acceptance:**
  - `grep -n "bias: 'independent'" src/tools/read-competitor-changelog.ts` returns zero matches in the file (only `'conflicted'` and `'unknown'` valid for this tool's competitor-tied sources).
  - Both contribution strings include the word `"conflicted"` to make the bias explicit to downstream LLM consumers.
- **Dependencies:** none
- **Complexity:** S

#### T10 — Longest-trigger-first sort in `platform-keywords.ts` (D-T16-1)
- **Goal:** Two options per CONTEXT.md; chosen: **add a `getMatchingPlatforms(haystack: string): PlatformEntry[]` helper that sorts the static array by descending max(trigger length) BEFORE matching**, so the first match wins for any haystack. Rationale (opinionated call): touching the consumer is safer than mutating the static array's natural reading order, which currently groups entries by ecosystem (Apple / Google / Social / etc.) for human review.

  Implementation:
  - Add `getMatchingPlatforms(haystack: string): PlatformEntry[]` to `src/lib/platform-keywords.ts`. Returns matched entries in DESCENDING max-trigger-length order.
  - Update `src/tools/assess-platform-dependency.ts` to consume `getMatchingPlatforms()` instead of its current inline scan (find the inline scan via grep — it iterates `PLATFORM_KEYWORDS` directly).
  - Tie-break on equal max-trigger-length: array declaration order (stable).
- **Files:** `src/lib/platform-keywords.ts` (~30 lines added); `src/tools/assess-platform-dependency.ts` (replace inline scan with helper call, ~10 lines net change)
- **Spec refs:** §11 sound-reasoning clause 3; deferred-items.md D-T16-1.
- **Acceptance:**
  - For haystack `"Android Digital Wellbeing focus app"`, `getMatchingPlatforms()`'s FIRST matched entry is `Android Digital Wellbeing`, not `Android platform APIs` (covered by **T-V07**).
  - For haystack `"my app uses ios and the screen time api"`, returned order includes `Apple Screen Time API` BEFORE `iOS / Apple platform APIs`.
  - `grep -n "PLATFORM_KEYWORDS\." src/tools/assess-platform-dependency.ts` shows no direct iteration; only `getMatchingPlatforms(...)` call.
- **Dependencies:** none
- **Complexity:** S

---

### Stream E — Caching wiring (M8)

#### T11 — Cache audit: identify which tools need tool-layer caching (vs already library-cached)
- **Goal:** Before wiring `cacheGet/cacheSet`, run a structural audit so T12 only wraps where it adds value. Each library that already caches internally should NOT be double-wrapped at the tool layer.
  - Inspect `src/lib/serper.ts`, `src/lib/producthunt.ts`, `src/lib/github.ts` (already imports `cache`), `src/lib/hn.ts` (already imports `cache`), `src/lib/reddit.ts` (already imports `cache`).
  - Record findings in `.planning/phases/02-tool-quality-and-test-harness/cache-audit.txt`. For each library: `LIB-CACHED` or `NOT-CACHED`. For each tool: `TOOL-WRAP-RECOMMENDED` or `SKIP-ALREADY-CACHED-AT-LIB`.
  - **Expected outcome (planner's pre-audit hypothesis, verified by audit):** `github.ts` / `hn.ts` / `reddit.ts` already cache → skip lib-layer wrap. `serper.ts` does NOT cache → its consumers DO benefit from tool-layer caching. `producthunt.ts` does NOT cache → ditto. Therefore the tool-layer cache wraps are most useful at the ORCHESTRATION tools that compose multiple Serper / PH calls: `find_pricing_anchors`, `find_why_now_signals`, `check_big_tech_encroachment`, `estimate_demand_signals`, `find_public_revenue_signals`, `assess_platform_dependency`, `scan_producthunt_launches`. That's 7 candidates; ≥5 needed per CONTEXT.md success criterion.
- **Files:** `.planning/phases/02-tool-quality-and-test-harness/cache-audit.txt` (new audit artifact)
- **Spec refs:** §11 DoD (tool budget <20); §7 tool-reuse rule.
- **Acceptance:**
  - Audit file lists every library + every tool with a classification.
  - Audit confirms ≥5 orchestration tools as `TOOL-WRAP-RECOMMENDED` candidates.
- **Dependencies:** none (can run in parallel with Streams A/B/C/D)
- **Complexity:** S

#### T12 — Wire tool-layer caching into the recommended tools
- **Goal:** Apply the standard pattern at the TOP of each handler in the tools T11 audit flagged:
  ```ts
  const cacheKey = makeCacheKey('find_pricing_anchors', category, ...competitors);
  const cached = cacheGet<ToolResult<FindPricingAnchorsData>>(cacheKey);
  if (cached) return { content: [{ type: 'text', text: JSON.stringify(cached, null, 2) }] };
  // ... existing handler body builds `result` ...
  cacheSet(cacheKey, result, TTL.SHORT); // 5 min default; orchestration outputs can drift faster than lib snapshots
  ```
  TTL selection (planner's call, opinionated):
  - **`find_pricing_anchors`** → `TTL.SHORT` (5 min). Pricing pages change; user re-runs are usually iterative on the same idea within minutes.
  - **`check_big_tech_encroachment`** → `TTL.MEDIUM` (1 hr). Conference signals are stable hour-to-hour.
  - **`find_why_now_signals`** → `TTL.MEDIUM`. Same reasoning.
  - **`estimate_demand_signals`** → `TTL.MEDIUM`. GitHub stats refreshed hourly is fine.
  - **`find_public_revenue_signals`** → `TTL.MEDIUM`.
  - **`assess_platform_dependency`** → `TTL.LONG` (24 hr). ToS pages and platform keyword maps are extremely stable.
  - **`scan_producthunt_launches`** → `TTL.MEDIUM`. New launches surface daily, not hourly.
  Normalize args before keying: lowercase + trim; sort `competitors` array before joining; drop optional framing object from key (cache hit across framings is safe — the framing only affects auto_flags downstream, not the fetched evidence).

  **TTL interaction with T02 (per PLAN-CHECK warning 2):** the OUTER tool-layer cache here is `TTL.SHORT` (5 min) for `find_pricing_anchors`; the INNER lib-layer cache from T02 (competitor → hostname mapping) is `TTL.LONG` (24 hr). The two TTLs are intentional — when the outer cache expires after 5 minutes, the inner cache still serves the domain resolution from a single Serper call, so re-runs within 24h cost zero Serper quota for domain lookups regardless of outer cache state. The inner cache is the long-term quota saver; the outer cache is the fast-path for iterative back-to-back runs.
- **Files:** 7 tool files (per T11 audit output). Estimated ~10 lines added per file.
- **Spec refs:** §11 DoD tool budget; §7 tool-reuse rule ("Tools serving multiple gates are called ONCE").
- **Acceptance:**
  - Each wrapped tool has `cacheGet` + `cacheSet` calls. Grep check: `grep -lE "cacheGet|cacheSet" src/tools/ | wc -l` returns ≥5.
  - **T-V08** (cache parser test) confirms repeated invocations with identical args return the cached object without re-running the fetch path (mocked).
  - Manual smoke: rerun `npx tsx scripts/assert-fomi-run.ts` after this lands — should still PASS, and tool-call count in Methodology Notes should be ≤ previous Phase 01 baseline (currently 12 per `01-fomi-focus-app.md`).
- **Dependencies:** T11 (audit must complete first); does NOT depend on Stream A/B/C/D fixes (caching wraps the handler regardless of internal content)
- **Complexity:** M

---

### Stream F — Test harness (L1)

Vitest setup + targeted parser/renderer tests. Per CONTEXT.md "L1 risk": snapshot only the deterministic renderer; everything else is assertion-based.

#### T-V01 — Install Vitest; add config + package.json scripts
- **Goal:** Add Vitest as a devDependency. Create `vitest.config.ts` configured for ESM + Node environment + glob `src/**/*.test.ts` and `scripts/**/*.test.ts`. Add scripts to `package.json`:
  - `"test": "vitest run"`
  - `"test:watch": "vitest"`
  - `"test:run": "vitest run"` (alias for CI clarity)
- **Files:** `package.json` (modify), `vitest.config.ts` (new, ~25 lines)
- **Spec refs:** CONCERNS.md L1.
- **Acceptance:**
  - `npm install` succeeds; `vitest` in `devDependencies`.
  - `npm test` exits 0 (with no tests written yet, Vitest reports 0 tests and exits 0).
- **Dependencies:** none (parallelizable with all of Stream A/B/C/D/E)
- **Complexity:** S

#### T-V02 — Test: `effectiveBias()` rules (lib/bias.ts)
- **Goal:** New `src/lib/bias.test.ts` covering all four input flags:
  - `effectiveBias('unknown') === 'vendor-funded'` (spec §4 rule 4)
  - `effectiveBias('independent') === 'independent'`
  - `effectiveBias('vendor-funded') === 'vendor-funded'`
  - `effectiveBias('conflicted') === 'conflicted'`
  Plus `conflictedRatio` math on a sample 4-source array (2 conflicted → 0.5); `decidingTierSources` excludes only D-tier.
- **Files:** `src/lib/bias.test.ts` (new, ~50 lines)
- **Spec refs:** §4 rules 1-4; CONCERNS.md L1.
- **Acceptance:** `npx vitest run src/lib/bias.test.ts` exits 0 with ≥6 passing assertions.
- **Dependencies:** T-V01
- **Complexity:** S

#### T-V03 — Test: `extractPriceTiers` currency-anchored regex + free-tier (M1 regression guard)
- **Goal:** New `src/tools/find-pricing-anchors.test.ts`. Cases:
  - HTML noise input `"copyright &#8217; 2024 class=col-474"` → `tiers === []` (no false positives).
  - Mixed input `"buy now for $39/mo or $399/yr lifetime"` → `tiers` contains both `'$39/mo'` and `'$399/yr'`.
  - Free-tier input `"Free forever, then $10/mo"` → `tiers` contains `'Free'` AND `'$10/mo'`.
  - Bare numbers `"version 8217 release"` → `tiers === []`.
- **Files:** `src/tools/find-pricing-anchors.test.ts` (new, ~80 lines — extract the parser into a non-default export for testability if needed; this is part of the task)
- **Spec refs:** CONCERNS.md M1; §11 sound-reasoning clause 1.
- **Acceptance:** All 4 cases pass; total ≥5 assertions in file.
- **Dependencies:** T01, T-V01 (CAN run in Wave 2 per PLAN-CHECK info item — T01 finishes in Wave 1)
- **Complexity:** S

#### T-V04 — Test: `detectRecency` classifications (check-big-tech-encroachment)
- **Goal:** New `src/tools/check-big-tech-encroachment.test.ts`. Cases (must export `detectRecency` from the tool file as part of the task):
  - `detectRecency('WWDC 2026 session')` → `'last_24mo'`.
  - `detectRecency('WWDC 2026 keynote (current year)')` → `'last_24mo'` (validates `CURRENT_YEAR` baseline).
  - `detectRecency('1999 keynote retrospective')` → `'older'`.
  - `detectRecency('Apple developer documentation')` → `'unknown'` (no year string).
- **Files:** `src/tools/check-big-tech-encroachment.test.ts` (new, ~50 lines — also covers T-V05 below in the same file)
- **Spec refs:** CONCERNS.md L1; spec §7 (recency feeds adjacency score).
- **Acceptance:** 4 assertions pass.
- **Dependencies:** T-V01
- **Complexity:** S

#### T-V05 — Test: acquisition regex positives + negatives (M4 regression guard)
- **Goal:** In `src/tools/check-big-tech-encroachment.test.ts` (same file as T-V04), add a test block driving the acquisition-extraction logic against 14 fixture headlines (10 original + 4 negative-trade-off lock-ins per PLAN-CHECK warning 4). Required cases:
  - **5 positive (must extract correct company name):**
    1. `"Apple acquires Pixelmator for $200M"` → captures `'Pixelmator'`.
    2. `"Google acquired Looker in a $2.6B deal"` → captures `'Looker'`.
    3. `"Microsoft acquires Activision Blizzard in a $69B deal"` → captures `'Activision Blizzard'`.
    4. `"Meta acquired CTRL-labs for $1B"` → captures `'CTRL-labs'`.
    5. `"Amazon acquires iRobot in a $1.7B deal"` → captures `'iRobot'`.
  - **5 negative (must drop, NOT fall back to headline slice):**
    1. `"Apple's strategy after acquiring Pixelmator hints at deeper AI ambitions"` → dropped.
    2. `"Why Google acquired Looker last year — analysts weigh in"` → dropped (no terminal price/deal anchor).
    3. `"Apple acquires AI startup — sources"` → dropped (no `$X` or `deal` end-anchor).
    4. `"Acquisition rumors swirl as Apple acquires team for new project"` → dropped.
    5. `"Microsoft's acquisition spree: who's next?"` → dropped (no `acquires/acquired` + name pattern).
  - **NEGATIVE-CASE FIXTURES (per PLAN-CHECK warning 4 — at least 4; these are headlines the OLD fuzzy regex would have matched but the NEW strict regex correctly rejects, documenting the false-negative trade-off):**
    1. `"Apple snaps up small AI startup"` → returns null (no extraction). Old fuzzy regex would have fallen back to headline slice.
    2. `"Google reportedly in talks to buy WordSmith"` → returns null. Old fuzzy logic might have flagged "buy" as acquisition signal.
    3. `"Microsoft eyes acquisition of analytics firm"` → returns null. "eyes acquisition" lacks the `acquires/acquired` verb shape.
    4. `"Why did Meta acquire [headline truncated...]"` → returns null. Truncated/malformed headline must NOT produce a headline-slice fallback entry.
  - These fixtures DOCUMENT the false-negative trade-off — if a future change reverts to looser matching, these tests fail and the reviewer sees the choice was deliberate (per spec §11 anti-pattern 2: no made-up data > more signal).
- **Files:** same as T-V04 — `src/tools/check-big-tech-encroachment.test.ts` (extend, ~120 lines added total)
- **Spec refs:** CONCERNS.md M4; §11 anti-pattern 2.
- **Acceptance:** 14 of 14 fixtures match expectation (5 positives extract correctly, 5 fuzzy-shape negatives drop, 4 trade-off-lock negatives drop).
- **Dependencies:** T05, T-V04
- **Complexity:** M

#### T-V06 — Test: Reddit URL helpers (urlToId / urlToPermalink / extractSubreddit)
- **Goal:** New `src/lib/reddit.test.ts`. Fixtures from real Reddit URLs:
  - `urlToId('https://www.reddit.com/r/productivity/comments/abc123/foo_bar/')` → `'abc123'`.
  - `urlToPermalink(...)` round-trips.
  - `extractSubreddit(...)` returns `'productivity'`.
  - Edge: comment-permalink URL → still extracts post id, not comment id.
  - Edge: malformed URL → returns null / fallback (no throw).
- **Files:** `src/lib/reddit.test.ts` (new, ~60 lines). Helpers must be exported if not already (part of task).
- **Spec refs:** CONCERNS.md L1; CONCERNS.md M7 (acknowledges Reddit's Serper-shaped data).
- **Acceptance:** ≥5 assertions pass.
- **Dependencies:** T-V01
- **Complexity:** S

#### T-V07 — Test: platform keyword precedence (D-T16-1 regression guard)
- **Goal:** New `src/lib/platform-keywords.test.ts`. Cases:
  - `getMatchingPlatforms('Android Digital Wellbeing focus app')[0].platform === 'Android Digital Wellbeing'`.
  - `getMatchingPlatforms('my ios app uses screen time api')` — `Apple Screen Time API` precedes `iOS / Apple platform APIs` in the returned array.
  - `getMatchingPlatforms('no platforms mentioned here')` → `[]`.
  - `getMatchingPlatforms('chrome extension built on openai')` — both `Chrome Web Store` AND `OpenAI API` returned.
- **Files:** `src/lib/platform-keywords.test.ts` (new, ~50 lines)
- **Spec refs:** deferred-items.md D-T16-1; CONCERNS.md L1.
- **Acceptance:** ≥4 assertions pass.
- **Dependencies:** T10, T-V01 (CAN run in Wave 2 per PLAN-CHECK info item — T10 finishes in Wave 1)
- **Complexity:** S

#### T-V08 — Test: cache wrapper hits on repeated invocation (M8 regression guard)
- **Goal:** New `src/lib/cache.test.ts`. Cases:
  - `cacheSet('k', { v: 1 }, TTL.SHORT); cacheGet('k')` returns `{ v: 1 }`.
  - After advancing time past TTL (use `vi.useFakeTimers()`), `cacheGet('k')` returns `null`.
  - `makeCacheKey('tool', 'Foo', 'BAR baz')` returns lowercased + space-replaced key (`'tool:foo:bar_baz'`).
  - **Integration check:** mock `serperSearch` (or stub via env var), invoke `find_pricing_anchors` twice with identical args, assert mock was called once (cache hit on second invocation). This is the M8 acceptance signal.
- **Files:** `src/lib/cache.test.ts` (new, ~70 lines)
- **Spec refs:** CONCERNS.md M8; §11 DoD tool budget.
- **Acceptance:** ≥4 assertions pass; integration check confirms second invocation does not call the mocked Serper.
- **Dependencies:** T12, T-V01
- **Complexity:** M

#### T-V09 — Renderer snapshot test (deterministic render only; per R5)
- **Goal:** New `src/validation/renderer.test.ts`. Imports `__fixtures__/synthetic-report.ts:validReport` (already exists per Phase 01 T08), passes through `renderReport()`, snapshots output to `src/validation/__snapshots__/renderer.test.ts.snap`. Any future drift in deterministic rendering fails the snapshot.
  - Snapshot strictly the renderer output. Do NOT snapshot LLM outputs anywhere (per Risk R5).
  - Include a second test: render with `report.spiky_pov` populated → assert output still emits the canonical blank template (defense-in-depth check from Phase 01 T07).
- **Files:** `src/validation/renderer.test.ts` (new, ~40 lines); `src/validation/__snapshots__/renderer.test.ts.snap` (auto-generated on first run)
- **Spec refs:** §5 artifact spec (renderer ground truth); CONCERNS.md L1.
- **Acceptance:**
  - First run generates snapshot; second run with no changes passes.
  - Spiky-POV-populated input still renders the blank template (assertion separate from snapshot).
- **Dependencies:** T-V01
- **Complexity:** S

---

### Final regression + bookkeeping

#### T-final-1 — Mark CONCERNS.md M1–M9 + deferred items resolved
- **Goal:** Update `.planning/codebase/CONCERNS.md`:
  - **M1** → `**Resolved 2026-MM-DD by Phase 02 T01 (currency-anchored regex) + T-V03 (regression test)**`
  - **M2 + D-01** → `**Resolved 2026-MM-DD by Phase 02 T02 (Serper-resolved hostname + www variants)**`
  - **M3** → `**Verified closed (Phase 01 H8) — no Phase 02 changes**` (per PLAN-CHECK info item — no date, Phase 02 didn't reopen this)
  - **M4** → `**Resolved 2026-MM-DD by Phase 02 T05 (end-anchored regex; drop-on-fallthrough) + T-V05 (14-fixture regression test incl. 4 trade-off-lock negatives)**`
  - **M5** → `**Resolved 2026-MM-DD by Phase 02 T06 (category-platform-features synonym map + delta-fired check)**`
  - **M6** → `**Resolved 2026-MM-DD by Phase 02 T07+T08 (PH topics API resolution + honest gap logging + fallback to search if API unauthorized)**`
  - **M7** → leave OPEN (subscriber-count gap partially addressed by Phase 01 T12b; not in Phase 02 scope).
  - **M8** → `**Resolved 2026-MM-DD by Phase 02 T11+T12 (tool-layer caching wired to 7 orchestration tools) + T-V08 (cache-hit regression test)**`
  - **M9** → `**Resolved 2026-MM-DD by Phase 02 T03 (per-competitor liveFetchCount counter)**`
  - Update `.planning/phases/01-anti-bias-hardening/deferred-items.md`: mark D-01 / D-T04-2 / D-T16-1 resolved with the respective T02 / T09 / T10 references. Add new D-XX entry from T07 if PH topics API was unavailable.
- **Files:** `.planning/codebase/CONCERNS.md`, `.planning/phases/01-anti-bias-hardening/deferred-items.md`
- **Spec refs:** none (planning hygiene).
- **Acceptance:** Every M-item and deferred-item carries a Phase 02 resolution annotation (M3 status updated per info item — no date).
- **Dependencies:** T01–T12, T-V01–T-V09 (everything must ship before bookkeeping).
- **Complexity:** S

#### T-final-2 — Artifact-level regression: re-run `assert-fomi-run.ts` against captured Phase-01 artifact
- **Goal:** Re-run `npx tsx scripts/assert-fomi-run.ts` against the EXISTING `.planning/validation-runs/01-fomi-focus-app.md` artifact (captured in Phase 01 T19). This verifies that Phase 02 tool/validator/renderer changes did not break the assertion script's ability to read and validate the historical artifact — i.e., the schema, regex anchors, and assertion logic still align. This is a CAPTURED-ARTIFACT regression check only — a fresh end-to-end LLM rerun is the load-bearing calibration and lives in T-final-3.
  - Must exit 0 with `6/6 assertions passed`.
  - Capture stdout and append to `.planning/validation-runs/02-fomi-regression-against-phase-01-artifact.md` with a 1-line summary: "Phase 02 fixes M1/M2/M4/M5/M6/M8/M9 + D-01/D-T04-2/D-T16-1; cache wired to 7 tools; Vitest at 38+ assertions passing. This run validates assert-fomi-run.ts still reads the Phase 01 artifact correctly."
  - **If the assertion script can no longer parse the artifact:** STOP. That means a Phase 02 change broke a schema/contract the assertion script depends on; fix the assertion script (or the renderer if drift is real) before proceeding.
- **Files:** `.planning/validation-runs/02-fomi-regression-against-phase-01-artifact.md` (new, output of `assert-fomi-run.ts` + summary line)
- **Spec refs:** §10 Phase 4 Critical Test (structural validity arm); §11 DoD.
- **Acceptance:**
  - `scripts/assert-fomi-run.ts` exits 0 against the Phase 01 artifact.
  - Capture file exists with stdout transcript.
- **Dependencies:** T-final-1 (so the resolution annotations are in place before the regression run goes on record)
- **Complexity:** S

#### T-final-3 — Fresh end-to-end Fomi rerun (load-bearing Critical Test)
- **Goal:** Re-execute `validate_idea` against the Fomi case end-to-end via stdio JSON-RPC orchestration (same pattern as Phase 01 T19), capture the new artifact, then re-run `assert-fomi-run.ts` against the NEW artifact. This is the load-bearing calibration check — Phase 02 changed multiple tools, and the Critical Test should be re-run to confirm the verdict still holds with the fixes applied. Per PLAN-CHECK Q10.3, T-final-2 alone is a weaker gate than the Phase 01 H7 calibration was; T-final-3 closes that gap.

  **Execution flow:**
  1. Start the MCP server via stdio (same harness Phase 01 T19 used).
  2. Send a `validate_idea` JSON-RPC request with the Fomi prompt verbatim (pulled from `.planning/validation-runs/01-fomi-focus-app.md` frontmatter or the originating Claude-Desktop transcript).
  3. Capture the streamed tool calls + final artifact to `.planning/validation-runs/02-fomi-regression-after-phase-02.md`.
  4. Run `npx tsx scripts/assert-fomi-run.ts --artifact .planning/validation-runs/02-fomi-regression-after-phase-02.md` (extend assert-fomi-run.ts to accept an `--artifact` flag if it doesn't already; this is part of the task — small additive change, defaults to the Phase 01 artifact when flag absent).
  5. PASS iff verdict still NO-GO AND all 6 assertions PASS.

  **If verdict flips (NO-GO → GO or → INCONCLUSIVE), or an assertion fails:** STOP. Per CONTEXT.md "If a tool fix causes a different verdict, that's potentially a real bug (or the calibration anchor needs updating — document either way)." File a follow-up `T-final-3-followup.md` documenting which assertion flipped, candidate causes (most likely: T05 drops a real acquisition the old fuzzy logic surfaced; OR T02 resolves a domain to a different pricing page that lacks the WTP killshot signal; OR T06's synonym-map expansion surfaced a stronger/weaker hyperscaler signal; OR T09's bias-flip pushed Gate confidence below threshold via §4 rule 2). Route back to the responsible stream owner. **Do NOT change the validator or `assert-fomi-run.ts` regex to match a regressed output** — investigate the root cause first.

  **If 6/6 still PASS:** capture artifact and Phase 02 is done.
- **Files:** `.planning/validation-runs/02-fomi-regression-after-phase-02.md` (new — full LLM artifact); possibly `scripts/assert-fomi-run.ts` (small `--artifact` flag addition, ≤10 lines)
- **Spec refs:** §10 Phase 4 Critical Test (full calibration arm); §11 DoD ("validate_idea on the AI-native focus app idea returns NO-GO with sound reasoning"); CONTEXT.md "Constraints" — "no regressions in the Critical Test".
- **Acceptance:**
  - Fresh artifact captured at `02-fomi-regression-after-phase-02.md` with NO-GO verdict.
  - `assert-fomi-run.ts --artifact 02-fomi-regression-after-phase-02.md` exits 0 (6/6 PASS).
  - At least one Gate 3 DOK 1 fact mentions Apple Intelligence / Screen Time / Focus Modes / Digital Wellbeing (validates T06 synonym map fired end-to-end).
- **Dependencies:** T-final-2 (artifact-level check runs first as cheap pre-flight)
- **Complexity:** M

---

## Dependency Graph

```
Stream A (find-pricing-anchors.ts — sequential, single file)
  T01 ──▶ T02 ──▶ T03 ──▶ T04

Stream B (check-big-tech-encroachment.ts — sequential, single file + new lib)
  T05 ──▶ T06

Stream C (producthunt — sequential)
  T07 ──▶ T08

Stream D (independent edits, can be parallel with each other)
  T09  (read-competitor-changelog.ts)
  T10  (platform-keywords.ts + assess-platform-dependency.ts)

Stream E (cache wiring — depends on audit)
  T11 (audit) ──▶ T12

Stream F (test harness — T-V01 unlocks everything, then parser tests
                         depend on the respective parser fix)
  T-V01 ──┬──▶ T-V02 (bias)
          ├──▶ T-V04 ──▶ T-V05    (requires T05)
          ├──▶ T-V06 (reddit helpers)
          ├──▶ T-V09 (renderer snapshot)
          └──▶ depended on by:
              T-V03  (requires T01 + T-V01) — CAN run Wave 2
              T-V07  (requires T10 + T-V01) — CAN run Wave 2
              T-V08  (requires T12 + T-V01)

Final
  {all above} ──▶ T-final-1 ──▶ T-final-2 ──▶ T-final-3
```

**Critical path (longest sequence):**
T01 → T02 → T03 → T04 → T11 → T12 → T-V08 → T-final-1 → T-final-2 → T-final-3 (10 tasks).

**Parallelism opportunities (cross-stream — explicit for `/gsd-execute-phase`):**
- **Wave 1 (all start together, no inter-dep):** T01 (Stream A), T05 (Stream B), T07 (Stream C), T09 (Stream D), T10 (Stream D), T11 (Stream E), T-V01 (Stream F).
- **Wave 2 (unlocked by Wave 1):** T02 (after T01), T06 (after T05), T08 (after T07), T-V02 / T-V04 / T-V06 / T-V09 (after T-V01), T-V03 (after T01 + T-V01 — Wave 2 per info item), T-V07 (after T10 + T-V01 — Wave 2 per info item), T-V05 (after T05 + T-V04), T12 (after T11).
- **Wave 3:** T03 (after T02), T-V08 (after T12 + T-V01).
- **Wave 4:** T04 (after T03).
- **Wave 5 (sequential bookkeeping + regression):** T-final-1 → T-final-2 → T-final-3.

**Anti-parallelism (file-conflict locks):**
- Stream A tasks (T01–T04) all touch `src/tools/find-pricing-anchors.ts` → sequential.
- Stream B tasks (T05–T06) both touch `src/tools/check-big-tech-encroachment.ts` → sequential.
- Stream C tasks (T07–T08) touch a shared call chain → sequential.

---

## Risks & Mitigations

### R1: M2 Serper-based domain resolution adds 1 Serper call per competitor (quota pressure)
**Concern:** `find_pricing_anchors` typically runs against 5–10 competitors per invocation. Adding a Serper call per competitor adds 5–10 calls per tool fire. Serper free tier is 2,500 queries / month — a 10-competitor `validate_idea` run now costs 10 extra Serper queries on top of the existing pricing-history + review searches (so ~25 Serper calls per run vs ~15 today).

**Mitigation:**
- T02 caches the `competitor → hostname` mapping with `TTL.LONG` (24 hr). Repeated `validate_idea` runs within a day on similar idea sets share the resolution cache.
- T12's tool-layer cache wraps `find_pricing_anchors` itself with `TTL.SHORT` (5 min) — back-to-back iterations on the same idea reuse the entire tool result, including resolutions. (See T12 task body for the explicit TTL-interaction note.)
- Per CONTEXT.md "Constraints," correctness > quota in this phase. The trade is intentional and documented.

### R2: M5 synonym map is brittle (future hyperscaler announcements need code changes)
**Concern:** A WWDC 2027 announcement of "Apple Focus AI" or a Google I/O launch of a new productivity feature won't appear in `check_big_tech_encroachment` results until someone updates `category-platform-features.ts`.

**Mitigation:**
- Map is intentionally small and easy to update — 4 category entries seed v1.
- Documented in the map file's header comment as "opportunistic enhancement; not exhaustive coverage. Add entries as new hyperscaler features ship."
- The existing query base (`category + keywords`) still fires regardless of the synonym map — the synonyms ADD targeted queries, they don't REPLACE the base query. So even with a stale map, the tool degrades to current behavior.
- T06's delta check (after_count > before_count) provides ongoing visibility — if the map stops firing in a future regression, the delta check fails first.
- Future phase candidate: replace static map with an LLM sub-call at tool invocation time that generates synonyms per query. Deferred — too expensive for v1's tool budget.

### R3: M4 acquisition regex tightening may DROP real acquisitions the old fuzzy logic caught
**Concern:** The end-anchored regex requires `\s+(?:for\s+\$|in\s+a\s+\$|deal)` at the tail. Real-world headline `"Apple snaps up AI startup [Name]"` no longer matches. Net effect could be fewer acquisition signals reported, weakening Gate 3.

**Mitigation:**
- T-V05's 14-fixture quantitative test makes the regression boundary measurable. The 4 negative-trade-off lock-in fixtures explicitly document headlines the old fuzzy regex would have matched and the new strict regex correctly rejects. If a future engineer reverts to looser matching, these tests fail and force a deliberate trade-off conversation.
- T-final-3's fresh-LLM Fomi rerun is the ultimate guardrail: if the Fomi verdict shifts because Apple acquisitions stopped surfacing, T-final-3 fails and forces a re-evaluation.
- Documented trade-off (per CONTEXT.md): dropping fabricated acquisitions (false positives causing "Apple acquired AI strategy after Pixelmator hints at...") is worth missing some real ones. Spec §11 anti-pattern 2 ("returning made-up data") is the higher-priority rule.

### R4: M6 PH topics API may not exist or require different auth
**Concern:** T07 assumes Product Hunt's GraphQL exposes `topics(query: ...)` and `topic(slug: ...)`. The Phase 01 codebase has not tested this — current `searchProductHunt` only uses `posts(search: ...)`.

**Mitigation:**
- T07's fallback acceptance (per PLAN-CHECK warning 6) explicitly defines the success path when the topics API is unavailable: catch the error, log honest gap in `confidence_note`, preserve the query-by-string path, file a deferred-items.md D-XX entry. The user-visible deliverable (honest gap logging) is satisfied EITHER way.
- T08's wiring is explicitly a fallback chain: topic → fall back to search → both paths log the honest-gap state. The tool can NEVER return empty silently.

### R5: L1 test harness — snapshot drift can ossify a bug
**Concern:** Snapshot tests record current output as ground truth. If the rendered output contains a bug, the snapshot bakes it in. Future developers see "snapshot passes" and assume correctness.

**Mitigation:**
- Snapshot ONLY the renderer (T-V09). The renderer is table-driven, deterministic, and was code-reviewed in Phase 01. Renderer drift = real regression, not behavioral change.
- All parser tests (T-V02 through T-V08) are assertion-based, not snapshot-based. They test logic, not output shape.
- Never snapshot LLM outputs anywhere (this would ossify model behavior). The Fomi calibration artifact `01-fomi-focus-app.md` is intentionally NOT a Vitest snapshot — `scripts/assert-fomi-run.ts` makes mechanical assertions about specific properties, allowing the underlying markdown to drift.

### R6: Fomi calibration regression after all fixes (verdict-level)
**Concern:** Any of T05 (acquisition regex tightening), T02 (domain re-resolution), T06 (new hyperscaler query expansion), T09 (bias flip changing source counts for §4 rule 1), or T12 (cache returning stale results) could shift the Fomi verdict away from NO-GO.

**Mitigation:**
- **T-final-3 is the gating end-to-end check.** Phase 02 is not done until a fresh `validate_idea` rerun against Fomi exits 0 with 6/6 PASS AND verdict NO-GO.
- T-final-2 provides a cheaper pre-flight against the captured Phase-01 artifact — catches structural breaks early without paying the LLM cost.
- If T-final-3 fails: the failure-mode breakdown in T-final-3's task body hypothesizes the most likely cause per fix. T05/T06 are the highest-risk; T09 is medium (bias flip could push a gate from PASS to INCONCLUSIVE, changing fail-2 math); T02/T12 are lowest (resolution + caching shouldn't change verdict math, only delivery).
- Documented per CONTEXT.md: "If a tool fix causes the Fomi case to return a different verdict, document why before merging." T-final-3's failure path produces exactly that documentation.

### R7: T-final-3 fresh-LLM rerun introduces non-determinism (NEW — flagged by T-final-3 addition)
**Concern:** A fresh `validate_idea` invocation involves LLM tool-selection ordering, possible model-version drift between captured-artifact day and rerun day, and Serper / GitHub / PH freshness differences. A failure could mean (a) Phase 02 broke something, or (b) the world changed (new acquisition headlines, new PH launches, new hyperscaler announcements). Both deserve investigation but the latter is NOT a Phase 02 bug.

**Mitigation:**
- **Triage rule (load-bearing):** if T-final-3 fails, do NOT modify the validator, `assert-fomi-run.ts`, or test fixtures to make it pass. Instead, run T-final-2 first; if T-final-2 passes (captured artifact still validates) and T-final-3 fails (fresh artifact regresses), then the divergence is data-level, not code-level. Investigate which specific assertion failed; if the regression is attributable to a tool fix in Phase 02, route to the responsible stream owner. If it's attributable to "the world changed since 2026-MM-DD," document the new ground truth as a Phase 03 candidate (refresh calibration anchor) and consider the failure expected.
- **Do not "calibrate to match"** — that would ossify whatever the model emits on rerun day as ground truth, defeating the calibration's purpose.
- T-V05's 14 fixtures, T-V03's regex fixtures, and T-V07's platform-precedence fixtures all keep the deterministic parser layer locked, so an LLM-layer regression cannot be mistaken for a parser regression.

---

## Out of Scope (restated from CONTEXT.md)

- **L2** (stale branches) — housekeeping, can be done anytime.
- **L3** (Cursor / Claude Code smoke test) — pre-distribution check, separate phase.
- **L4** (regex `i` flag cosmetic) — opportunistic cleanup; will likely happen incidentally during T01 anyway.
- **L5** (dotenv cwd assumption) — opportunistic cleanup.
- **M7** (Reddit subscriber counts via OAuth) — Phase 01 T12b already added `/r/<sub>/about.json` access; full Reddit OAuth migration is post-v1.
- **D-T15-1** (grep proof was a false positive) — confirmed non-issue.
- New tools (Google Trends API integration, SimilarWeb proper integration, etc.) — Phase 03 candidates if/when budget allows.

---

## Definition of Done

Each box maps to specific task IDs. Phase 02 ships when every box is checked.

- [ ] **M1: `find_pricing_anchors` regex requires currency anchor.** No `"8217"` / `"474"` artifacts in `tiers[]`. → **T01** + **T-V03** regression test.
- [ ] **M2 + D-01: Competitor domain resolution via Serper top-result hostname, www-fallback in probe list.** Forest, Freedom, Opal, Cold Turkey, Rize all resolve correctly. → **T02**.
- [ ] **M3: Wayback URL handling verified closed.** Grep audit returns zero unfetched-URL citations. → **T04** annotation in CONCERNS.md (no date; "Verified closed (Phase 01 H8)").
- [ ] **M4: Acquisition regex end-anchored; entries dropped on fallthrough (no headline fallback).** → **T05** + **T-V05** 14-fixture regression test (10 standard + 4 trade-off lock).
- [ ] **M5: Hyperscaler search expanded via category→platform-feature synonym map.** `"focus app"` triggers Apple Intelligence + Screen Time + Focus Modes + Digital Wellbeing queries; **delta check confirms `after_count > before_count`**. → **T06**, integration-checked by **T-final-3** Assertion 3.
- [ ] **M6: `scan_producthunt_launches` returns ≥1 result for "focus app" OR honest gap in `confidence_note`.** Fallback acceptance covers PH topics API unavailability. → **T07** + **T08**.
- [ ] **M8: `cache.ts` integrated into ≥5 orchestration tools.** Cache-hit regression confirmed; TTL interaction (T02 inner LONG vs T12 outer SHORT) documented in T12. → **T11** audit + **T12** wiring + **T-V08** test.
- [ ] **M9: `confidence_note` reports actual per-competitor `fetchedSuccessfully` count.** → **T03**.
- [ ] **D-T04-2: `read_competitor_changelog` Serper-site source AND competitor-authored Wayback source both `bias: 'conflicted'`.** → **T09**, grep verifies `'independent'` no longer present in file.
- [ ] **D-T16-1: `getMatchingPlatforms` returns longest-trigger entry first.** "Android Digital Wellbeing" matches dedicated entry, not broader "android". → **T10** + **T-V07** regression test.
- [ ] **L1: Vitest installed; `npm run test` passes; ≥10 parser unit tests + 1 renderer snapshot test.** Count: T-V02 (6) + T-V03 (5) + T-V04 (4) + T-V05 (14) + T-V06 (5) + T-V07 (4) + T-V08 (4) = 42 assertions across 7 test files, plus T-V09 (1 snapshot + 1 assertion). Comfortably ≥10. → **T-V01** through **T-V09**.
- [ ] **CONCERNS.md M1–M9 + deferred items marked RESOLVED** with Phase 02 commit references. → **T-final-1**.
- [ ] **`scripts/assert-fomi-run.ts` re-run against captured Phase-01 artifact still exits 0 (6/6 PASS).** Capture artifact at `.planning/validation-runs/02-fomi-regression-against-phase-01-artifact.md`. → **T-final-2**.
- [ ] **Fresh end-to-end Fomi rerun produces NO-GO verdict; `assert-fomi-run.ts --artifact 02-fomi-regression-after-phase-02.md` exits 0 (6/6 PASS).** → **T-final-3**.

---

## Final Verification Step

T-final-3 is the load-bearing gate (T-final-2 is the cheaper pre-flight). After every other task lands:

```
# Step 1 — pre-flight (T-final-2)
$ npx tsx scripts/assert-fomi-run.ts
[T20] Assertion 1: Verdict NO-GO ........................ PASS (verdict=NO-GO)
...
[T20] OVERALL: 6/6 assertions passed — captured Phase-01 artifact ✓

# Step 2 — load-bearing fresh rerun (T-final-3)
$ npx tsx scripts/run-validate-idea.ts --prompt "Fomi: AI-native focus app" \
    > .planning/validation-runs/02-fomi-regression-after-phase-02.md
$ npx tsx scripts/assert-fomi-run.ts \
    --artifact .planning/validation-runs/02-fomi-regression-after-phase-02.md
[T20] Assertion 1: Verdict NO-GO ........................ PASS (verdict=NO-GO)
[T20] Assertion 2: Killshots cite ≥2 tier S/A ........... PASS (...)
[T20] Assertion 3: Gate 3 references encroachment kws ... PASS (matched: "Apple Intelligence" / "Screen Time")
[T20] Assertion 4: Tool call count line present ......... PASS (... calls, ≤20 ✓)
[T20] Assertion 5: Killshot count ≥ 2 ................... PASS
[T20] Assertion 6: Spiky POV blank template intact ...... PASS

[T20] OVERALL: 6/6 assertions passed — fresh Phase-02 artifact ✓ — Phase 02 done.
```

Exit code 0 on BOTH = Phase 02 done.

---

## Changelog

- **v0.1** (initial) — 19 tasks across 6 streams. Critical path 10 tasks.
- **v0.2** (2026-05-25) — addressed PLAN-CHECK.md (0 blockers, 6 warnings, 2 info applied).
  - **Warning 1:** added T-final-3 (fresh end-to-end Fomi rerun + capture + assert) as load-bearing Critical Test re-run; T-final-2 retained as cheaper artifact-level pre-flight.
  - **Warning 2:** documented TTL interaction between T02's inner LONG and T12's outer SHORT in T12 task body + R1 mitigation.
  - **Warning 3:** tightened T06 acceptance with delta check (before_count / after_count + new-source URL keyword assertion); elevated T06 from M to L given the additional scope.
  - **Warning 4:** added 4 negative-trade-off lock-in fixtures to T-V05 (total 14 fixtures); documents the false-negative trade-off so future loosening is detectable.
  - **Warning 5:** corrected complexity bookkeeping (see footer below).
  - **Warning 6:** added T07 fallback acceptance for PH topics API unavailability (3-clause path: log + preserve query path + file D-XX).
  - **Info 1:** updated wave assignments — T-V03 and T-V07 explicitly run in Wave 2 (not Wave 3).
  - **Info 2:** T-final-1 M3 status updated to "Verified closed (Phase 01 H8) — no Phase 02 changes" (no date).
  - **New risk R7:** documented fresh-LLM rerun non-determinism with explicit triage rule: do NOT calibrate to match.

---

*Phase plan v0.2. 20 tasks across 6 streams. Critical path: 10 sequential tasks. Estimated total complexity: 12 S + 7 M + 1 L = 20. All tasks atomic-committable. Plan ready for `/gsd-execute-phase`.*
