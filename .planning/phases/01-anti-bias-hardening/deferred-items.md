# Deferred Items — Phase 01

Issues discovered during execution that are out of scope for the current task per the SCOPE BOUNDARY rule. Track here so they don't get lost.

## D-01: `guessPricingUrl()` produces non-canonical domains for Wayback lookup

**Discovered during:** Stream A T02 smoke test (2026-05-20)
**File:** `src/tools/find-pricing-anchors.ts:32-39` (`guessPricingUrl`)
**Symptom:** Wayback lookups return null for many real competitors because `guessPricingUrl('RescueTime')` returns `https://rescuetime.com/pricing` (no `www.`), while Wayback only has snapshots for `https://www.rescuetime.com/pricing`. Direct `waybackLookup('https://www.rescuetime.com/pricing')` returns a real `20260510041848` snapshot; `waybackLookup('https://rescuetime.com/pricing')` returns null.
**Impact:** H8 fix is structurally correct (no fabrication) but Wayback coverage in practice is lower than it could be — many lookups will return null even when archives exist.
**Why deferred:** The H8 task is to eliminate fabrication, not to fix domain-guessing. Adding `www.`-fallback / multi-host probing to `guessPricingUrl` (or to `waybackLookup` itself) is a separate URL-normalization improvement. Belongs in M-tier (likely a new M concern: "competitor → canonical domain heuristic too narrow").
**Suggested fix:** Either (a) make `guessPricingUrl` return an array of candidate hosts (`rescuetime.com`, `www.rescuetime.com`) and try each, or (b) make `waybackLookup` retry with a `www.` prefix on miss.

**RESOLVED (Phase 02, 2026-05-25):** Resolved as part of M2 fix in Stream A T02 — Serper-based hostname resolution now returns canonical host (incl. `www.` variant where appropriate) before Wayback lookup. See commit 5213442.

---

## D-T04-2: `read_competitor_changelog` source bias mislabeled

**Discovered during:** Phase 01 (deferred to Phase 02 Stream B).
**RESOLVED (Phase 02, 2026-05-25):** Changelog sources are now labeled `conflicted` per spec §4 rule 6 (vendor-published content). See commit ac66861.

---

## D-T16-1: Android keyword precedence in platform-keywords matcher

**Discovered during:** Phase 01 (deferred to Phase 02 Stream C).
**RESOLVED (Phase 02, 2026-05-25):** Longest-trigger-first matcher in `platform-keywords` resolves precedence correctly (e.g. "Android Auto" wins over "Android"). See commit 246586c + regression guard commit 6b18b87 (T-V07).
