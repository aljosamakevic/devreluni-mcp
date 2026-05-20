# T04 Pre-Change Audit (2026-05-20)

> Conducted before any code changes for T04. Spec refs: §4 rule 4 (`unknown → vendor-funded`);
> §11 anti-pattern 6 (must not default `unknown` to `independent`).
> Commands run:
> - `grep -rn "bias:\s*'unknown'" src/`
> - `grep -rn 'bias:\s*"unknown"' src/`
> - `grep -rn "bias:\s*'independent'" src/tools/ src/lib/`
> - Manual inspection of `confidence_note` construction in every tool.

## Occurrences of bias: 'unknown'

Only ONE site in the entire `src/` tree emits a `ToolSource` with `bias: 'unknown'`:

- `src/lib/serper.ts:71` — `bias: live ? 'independent' : 'unknown'`
  - **Context:** `serperSource()` factory. When `SERPER_API_KEY` is unset, the stub
    source is correctly tagged `unknown` (per CONVENTIONS.md "Bias Flag Assignment"
    table and Stream A's prior commit). The on-the-wire flag is the raw `'unknown'`
    — transparency preserved.
  - **Classification:** **(c) candidate for `effectiveBias()` wrapping at consumer sites.**
    The source itself is correctly tagged. What's missing is that every tool that
    consumes serper sources and reasons about source mix in `confidence_note` math
    must route through `effectiveBias()` so the `unknown` counts as `vendor-funded`,
    not silently as something neutral.
  - **Downstream consumers of `serperSource()`:**
    - `src/tools/find-closest-competitor.ts:100` — adds to `sources[]`, no mix math in `confidence_note`. No behavior change needed; helper-import only (defense-in-depth).
    - `src/tools/find-pricing-anchors.ts` — uses serper search results but does not call `serperSource()` directly in the sources array (it pushes its own G2/Capterra source). No mix math against the serper source flag. No behavior change.
    - Other tools (`check-big-tech-encroachment`, `read-competitor-changelog`, `map-competitive-weaknesses`, `scan-producthunt-launches`, `get-category-failure-modes`, `find-yc-rfs-alignment`) — checked: none compute confidence_note from raw `s.bias` mixes; they emit static strings.

  **Net result:** no `BEHAVIOR-CHANGE-SITE` per the planner's T04-audit acceptance
  criterion. T04's "no behavior change" claim holds: the existing on-the-wire output
  does not change. T04 adds the import + uses `effectiveBias()` at the one site
  (`find-pricing-anchors.ts:300`) that reads `s.bias` directly, so future modifications
  remain spec-compliant.

## Occurrences of bias: 'independent' worth re-examining

Findings from `grep -rn "bias:\s*'independent'" src/tools/ src/lib/`:

- `src/lib/wayback.ts:119` — **(a) genuinely defensible.** Wayback CDX snapshot is
  an independent archive of the source page. Spec §4 (CONVENTIONS.md table) lists
  Wayback as `S/independent`. Correct.
- `src/lib/hn.ts:62` — **(a) genuinely defensible.** Hacker News comments are not
  written by the product vendor (spec §4: news/community aggregates ≈ A/independent).
  Correct.
- `src/lib/reddit.ts:92` — **(a) genuinely defensible.** Reddit community posts
  are user-generated, not vendor-controlled. Correct.
- `src/lib/producthunt.ts:119` — **(a) genuinely defensible.** ProductHunt launch
  pages are submitted by the makers but the surrounding ecosystem (votes, comments)
  is independent. Spec treats PH as A/independent for launch-signal data. Correct.
- `src/tools/find-pricing-anchors.ts:211` — **(a) genuinely defensible.** G2/Capterra
  review aggregation is independent (third-party review site). Spec §4 + CONVENTIONS.md
  tier table both confirm B/independent. Correct.
- `src/tools/find-yc-rfs-alignment.ts:170` — **(b) MISCLASSIFIED.** This is YC's
  own RFS publication. Per spec §4 rule 6 (positioning material from a stakeholder),
  YC RFS should be `conflicted` (YC has a clear stake in steering builders to
  categories where they'll fund), not `independent`. Plan T10 explicitly calls
  this out: *"RFS = A/independent (it's YC's own page = `conflicted` actually
  — see spec §4 rule 6; **use `conflicted` for YC RFS as a positioning signal**)"*.
  **However:** the canonical fix for this is in scope for Stream D (T10) per the
  PLAN.md note above, NOT Stream C. Flagged here for visibility; will be addressed
  by T10. **Action in T04: leave it as-is** (out of scope; would collide with T10).
- `src/tools/read-competitor-changelog.ts:187, 222` — **mixed.**
  - Line 187: Tier S/independent for changelog HTML directly fetched from competitor.
    A competitor's own changelog is `conflicted` (they author it about their own
    product, spec §4 rule 6). **Classification: (b) MISCLASSIFIED → conflicted.**
  - Line 222: B/independent for Serper site-search snippets *of* the competitor.
    Tier B is fine; bias depends on whether the snippet content is from the
    competitor's domain or aggregator commentary. The current line pushes
    `tier: 'B', bias: 'independent'` for a `site:<competitor>` search — that's
    the competitor's own pages surfaced via search. **Classification: (b) MISCLASSIFIED → conflicted.**
  - **Action in T04:** out of scope (Stream A and Stream D own changelog
    semantics; touching this file here would collide with future work on
    `read-competitor-changelog`). Documented as deferred items below.
- `src/tools/check-big-tech-encroachment.ts:245` — **(a) genuinely defensible.**
  Press coverage of acquisitions on TechCrunch/Verge/Bloomberg is independent
  reporting on hyperscaler activity. Correct.

## T04 action plan

In line with the **no-behavior-change scope** that T04-audit validates, T04 will:

- `src/tools/find-pricing-anchors.ts:300` — replace direct `s.bias === 'conflicted'`
  read with `effectiveBias(s.bias) === 'conflicted'`. Add import of `effectiveBias`
  from `../lib/bias.js`. This is the one site in the codebase that reads `s.bias`
  directly in a confidence-math expression. The fetched-count semantics are
  preserved (no S/conflicted source uses `unknown`), but the call site is now
  spec-compliant by construction and won't silently regress if a future change
  routes an `unknown` source through here.
- `src/tools/find-closest-competitor.ts` — add a defense-in-depth import + log
  the count of `unknown`-flagged sources in `confidence_note` via
  `requiresUpgradeFromUnknown()`. Disclosed transparency per spec §11 anti-pattern 6
  (the conversion must not be hidden). One-line addition in `confidenceParts`.

**Deferred items (D-XX style):**

- **D-T04-1:** `src/tools/find-yc-rfs-alignment.ts:170` mislabels YC RFS as
  `independent`. Spec §4 rule 6 says it must be `conflicted`. **Owner: T10** (per
  PLAN.md Stream D explicit call-out).
- **D-T04-2:** `src/tools/read-competitor-changelog.ts:187, 222` mislabel competitor
  changelog HTML / `site:` search snippets as `independent`. Both should be
  `conflicted` per spec §4 rule 6. **Owner: future Stream D follow-up** (not in
  current PLAN.md; recommended for inclusion in M-series tool quality phase
  per CONTEXT.md "Out of scope").

These deferred items are **explicitly out of T04 scope** because the planner's
T04 description (PLAN.md line 236) flags only `find-pricing-anchors.ts:155` (already
handled by Stream A) and `check-big-tech-encroachment.ts:172, 245` (verified
correct above) — and warns "do not blanket-change." Touching the changelog or
YC RFS files here would (a) collide with Stream D work and (b) exceed the
"small import + one or two replacement sites" scope rule.

## Audit summary

- Occurrences of `bias: 'unknown'`: **1** (`src/lib/serper.ts:71`, correctly tagged
  at source layer; consumer sites need `effectiveBias()` wrapping but no
  behavior change today).
- Occurrences of `bias: 'independent'` flagged for re-examination: **3** sites
  classified as `(b) misclassified` (1 in `find-yc-rfs-alignment.ts`, 2 in
  `read-competitor-changelog.ts`); all **deferred** to other streams per
  PLAN.md ownership boundaries.
- Behavior-change sites for T04: **0**.
- Changes planned in T04: **2** files modified (`find-pricing-anchors.ts`,
  `find-closest-competitor.ts`); both are import + small replacement / addition;
  no on-the-wire output regression expected.
