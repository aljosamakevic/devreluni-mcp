# Phase 02 — Tool Quality + Test Harness

## Phase goal

Close the 9 MEDIUM concerns (M1–M9) from `.planning/codebase/CONCERNS.md`, the deferred items inherited from Phase 01 (D-01, D-T04-2, D-T16-1), and bootstrap a Vitest test harness (L1) targeting the parsers most likely to drift. Phase 01 made the anti-bias guarantees structurally enforced — Phase 02 makes the **signal-emitting tools accurate enough that those guarantees have real material to validate**.

## Why this matters

Phase 01's validator pipeline can refuse a NO-GO with thin or fabricated evidence. But if the underlying tools emit noisy or mis-tiered data, the validator is just enforcing structural well-formedness over garbage inputs. The Fomi calibration (Phase 01 H7) passed because the structural killshots happened to be discoverable with current tool quality. Future ideas in less-canonical categories may NOT surface their killshots if:

- `find_pricing_anchors` parses HTML noise as prices (M1) or misses 50% of competitor domains (M2)
- `check_big_tech_encroachment` extracts article titles instead of acquired companies (M4) or misses obvious encroachment keywords (M5)
- `scan_producthunt_launches` returns empty for queries that clearly have results (M6)
- `read_competitor_changelog` mislabels conflicted sources as independent (D-T04-2)

This phase removes that systemic noise. After Phase 02, the framework is calibration-ready against any product idea, not just the canonical Fomi case.

## In scope

### Stream A — Tool parser/heuristic fixes
- **M1** — `find_pricing_anchors` price parser noise (regex captures HTML noise like `"8217"`, `"474"`)
- **M2** — `find_pricing_anchors` domain guessing fails ~50% (Forest is `forestapp.cc`, Freedom is `freedom.to`)
- **D-01** — `guessPricingUrl` strips `www.` causing Wayback host mismatch (closely related to M2; bundle the fix)
- **M9** — `find_pricing_anchors` `confidence_note` math (boolean expanded across competitors → inflated "live fetched" count)
- **M3** — Wayback URL handling (already mostly addressed by H8 fix in Phase 01; verify and close)

### Stream B — Big-tech encroachment hardening
- **M4** — Acquisition regex extracts article titles instead of company names — tighten regex + reject on fallthrough
- **M5** — Conference search misses obvious signals (e.g. "Apple Intelligence", "Screen Time API") due to literal keyword match — add a synonym map from category → platform-feature names

### Stream C — Product Hunt empty-results fix
- **M6** — `scan_producthunt_launches` returns empty even when results exist. Add topic-resolution step (PH topics API) + clear `confidence_note` when topic search returns nothing

### Stream D — Source bias mislabeling cleanup
- **D-T04-2** — `read_competitor_changelog.ts:187,222` mislabels competitor-authored changelog HTML and `site:<competitor>` Serper snippets as `independent`. Should be `conflicted` per spec §4 rule 6.
- **D-T16-1** — `assess_platform_dependency` keyword precedence: "Android Digital Wellbeing" matches the broader "android" trigger first. Sort longest-trigger first, or prefer exact-canonical match before substring fallback.

### Stream E — Caching wiring
- **M8** — `src/lib/cache.ts` exists but is unused by tools. Wire it in for each tool's main fetch (keyed by tool name + normalized args, TTL = one session). Spec §11 DoD: "Tool call budget stays under 20 tool calls per `validate_idea` run."

### Stream F — Test harness
- **L1** — Bootstrap Vitest. Add unit tests for the parsers most likely to drift:
  - `extractPriceTiers` (find-pricing-anchors)
  - `detectRecency` (check-big-tech-encroachment, find-why-now-signals)
  - Acquisition regex (check-big-tech-encroachment)
  - Platform keyword precedence (assess-platform-dependency)
  - `effectiveBias()` rules (already has self-check, formalize)
  - `urlToId/urlToPermalink/extractSubreddit` (reddit-via-serper)
- Add one end-to-end snapshot test: feed `synthetic-report.ts` `validReport` through `renderReport` and snapshot the markdown — catches renderer regressions
- Add CI hook in `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`

## Out of scope

- **L2** (stale branches) — housekeeping, can be done anytime, no need for a phase
- **L3** (Cursor/Claude Code smoke test) — pre-distribution check, separate phase
- **L4, L5** (cosmetic regex `i` flag, dotenv cwd assumption) — leave for opportunistic cleanup
- **D-T15-1** (grep proof was a false positive) — non-issue
- Any new tool work (Phase 03 candidate: enrichment tools, e.g. Google Trends API integration, SimilarWeb if/when budget allows)
- Re-running the Fomi calibration after fixes (would be a Phase 02 verification step, but covered by L1 snapshot test instead)

## Success criteria

- [ ] M1: `find_pricing_anchors` regex requires currency anchor; no more `"8217"` / `"474"` artifacts in `tiers[]`
- [ ] M2 + D-01: domain resolution via Serper search (`<competitor> pricing`), top result hostname used. Forest/Freedom/Opal/Cold Turkey/Rize all resolve correctly.
- [ ] M4: acquisition regex requires end-anchor (`for $X`, `in a $X deal`); on no-match, entry is dropped (not fallback to headline)
- [ ] M5: each hyperscaler search expanded via category-to-platform-feature synonym map (e.g. `focus app` → `Focus Modes`, `Screen Time`, `Digital Wellbeing`, `Apple Intelligence`)
- [ ] M6: `scan_producthunt_launches` either returns ≥1 result for "focus app" OR explicitly logs "topic resolution returned 0 matches" in `confidence_note`
- [ ] M8: `src/lib/cache.ts` integrated into ≥5 tool entry points; cached-hit-on-repeated-query confirmed in tests
- [ ] M9: `find_pricing_anchors` `confidence_note` reports actual `fetchedSuccessfully` per-competitor count
- [ ] D-T04-2: `read_competitor_changelog` Serper site:<competitor> sources tagged `bias: 'conflicted'`; competitor-authored changelog HTML tagged `bias: 'conflicted'`
- [ ] D-T16-1: `assess_platform_dependency` keyword map sorted longest-trigger-first; "Android Digital Wellbeing" matches the dedicated entry, not the broader "android" trigger
- [ ] L1: Vitest installed; `npm run test` passes; ≥10 parser unit tests + 1 renderer snapshot test
- [ ] CONCERNS.md M1-M9 + D-01/D-T04-2/D-T16-1 marked RESOLVED with commit references
- [ ] `scripts/assert-fomi-run.ts` re-run after all fixes: still exits 0 (no regression in the Critical Test)

## Constraints

- **Spec §4 + Phase 01 anti-bias rules remain inviolate.** No source can change tier or bias in a way that loosens the validator's job. Specifically: D-T04-2's bias flip from `independent → conflicted` is a CORRECTNESS fix that makes the validator stricter, not looser.
- **No regressions in the Critical Test.** After Phase 02, re-running `npx tsx scripts/assert-fomi-run.ts` must still report 6/6 PASS. If a tool fix causes the Fomi case to return a different verdict, document why before merging.
- **Tool count stays 13.** Phase 02 does not add new tools — it tightens existing ones.
- **Atomic commits.** Each task is one commit (M-fix or test-add). Pattern proven across 29 commits in Phase 01.
- **Build green after every commit.** Standard rule.

## Required reading for planner

- `.planning/spec/build-spec-v1.0.md` — especially §4 (source tier system), §7 (`ToolResult<T>` envelope), §11 (DoD + anti-patterns)
- `.planning/spec/framework-context.md` — Fomi case study + framework lineage (for L1 snapshot test fixture)
- `.planning/codebase/CONCERNS.md` — M1-M9, L1, with file:line refs throughout
- `.planning/phases/01-anti-bias-hardening/PLAN.md` + `PROGRESS.md` — Phase 01 patterns (atomic commit cadence, executor brief shape, wave structure)
- `.planning/phases/01-anti-bias-hardening/deferred-items.md` — D-01, D-T04-2, D-T16-1 source descriptions
- `.planning/codebase/CONVENTIONS.md` — current code conventions (especially the Phase 01 additions: ValidationLayer, `effectiveBias`, Wayback-only-verified-snapshots)
- `.planning/codebase/STRUCTURE.md` — file inventory with current 13-tool status
- `.planning/codebase/TESTING.md` — current test posture (none) + the Vitest harness sketch the doc already outlines
- `src/tools/find-pricing-anchors.ts` — primary target of Stream A
- `src/tools/check-big-tech-encroachment.ts` — primary target of Stream B
- `src/tools/scan-producthunt-launches.ts` + `src/lib/producthunt.ts` — primary target of Stream C
- `src/tools/read-competitor-changelog.ts` — primary target of Stream D fix #1
- `src/tools/assess-platform-dependency.ts` + `src/lib/platform-keywords.ts` — primary target of Stream D fix #2
- `src/lib/cache.ts` — Stream E target
- `scripts/assert-fomi-run.ts` — the regression gate
