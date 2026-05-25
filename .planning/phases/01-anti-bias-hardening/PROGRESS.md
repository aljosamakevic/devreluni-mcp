# Phase 01 — Progress Snapshot

**Last updated:** 2026-05-20
**Branch:** `research-v2`
**Status:** Paused after Wave 3 — Streams A, B, C complete. Streams D, E pending.

---

## Completed work

### Wave 1 — Stream A (H8 Wayback fabrication)
| Task | Commit | Subject |
|---|---|---|
| T01 | `83799ad` | Add Wayback CDX client for verified historical snapshots |
| T02 | `d54ecf5` | Fix H8 — Wayback fabrication: only cite verified snapshots |

### Wave 2 — Stream B partial (T05–T08) + Stream C (parallel)
| Task | Commit | Subject |
|---|---|---|
| T05 | `157d3e3` | Add ValidationReport types matching spec §5 structure |
| T06 | `7581118` | Add ValidationReport zod schema with structural invariants |
| T07 | `67af958` | Add structural validator closing H1 + H2 (DOK separation, blank POV) |
| T08 | `a297f53` | Add verdict validator closing H4 + H5 (source counts, decision matrix) |
| T03 | `62cb855` | Add bias.ts helper enforcing spec §4 rule 4 (unknown→vendor-funded) |
| T04-audit | `a8d37c6` | Add T04-audit results — pre-change audit for effectiveBias wiring |
| T04 | `eee95af` | Fix H3 — wire effectiveBias into tools doing confidence math |

### Wave 3 — Stream B finish (T09a, T09b, T09c)
| Task | Commit | Subject |
|---|---|---|
| T09a | `6686388` | Add deterministic markdown renderer for ValidationReport |
| T09b | `23d67f6` | Add finalize_validation_report tool — validator pipeline + renderer |
| T09c | `53a26a9` | Rewrite validate_idea prompt to JSON-only — close markdown escape hatch |

---

## HIGH concerns status

| # | Concern | Status |
|---|---|---|
| H1 | DOK 1-4 separation | ✅ Structurally enforced (validator + renderer + prompt) |
| H2 | "Spiky POV" stays blank | ✅ Structurally enforced (renderer always emits constant) |
| H3 | `unknown → vendor-funded` for math | ✅ Closed (`effectiveBias()` wired) |
| H4 | PASS requires ≥2 tier-B+ sources | ✅ Structurally enforced (verdict validator) |
| H5 | Validation Checks decision matrix | ✅ Structurally enforced (verdict validator) |
| H8 | Wayback fabrication | ✅ Closed (real CDX API) |
| H6 | 4 missing tools per spec §10 | ⏳ Pending — Stream D (T10-T17) |
| H7 | Critical Test calibration | ⏳ Pending — Stream E (T18-T22) |

**6 of 8 HIGH concerns closed.** The four anti-bias mechanisms that the spec §1 calls "the core IP" are now load-bearing in code, not aspirational.

---

## Remaining work

### Wave 4 — Stream D (H6) — sequential per spec §10
1. T10 — `find_why_now_signals` (Gate 5 P0)
2. T11 — wire into tool-to-gate map
3. T12a — `src/lib/github.ts` client
4. T12b — `src/lib/reddit.ts` add `getSubredditMeta()`
5. T12c — `estimate_demand_signals` tool wiring T12a + T12b
6. T13 — wire into tool-to-gate map
7. T14 — `find_public_revenue_signals` (Gate 2 + 4 P1)
8. T15 — wire into tool-to-gate map
9. T16 — `assess_platform_dependency` (Gate 3 P1)
10. T17 — wire into tool-to-gate map + startup log

Realistic time: ~3-4 hours of agent execution. Recommended approach: one tool at a time (T10→T11, then T12*→T13, then T14→T15, then T16→T17) with smoke-test checkpoints between tools.

### Wave 5 — Stream E (H7) — gating
1. T18 — Create `.planning/validation-runs/` directory + README
2. T19 — Run `validate_idea` against the Fomi case (record artifact)
3. T20 — Assert NO-GO with mechanical source-tier check + Gate 3 Apple Intelligence reference
4. T21 — Mark CONCERNS.md H1–H8 resolved (or document residuals)
5. T22 — Update CONVENTIONS.md + ARCHITECTURE.md with new patterns

T20 is the gating assertion. If it fails (verdict is GO or CONDITIONAL GO, or killshots cite tier C/D sources, or Gate 3 misses Apple Intelligence), the phase isn't done.

---

## Resume instructions

When ready to continue:

1. `cd /Users/aljosamakevic/Documents/Buildground/Sandbox/03-devreluni-mcp/devreluni-mcp`
2. `git checkout research-v2` (or stay on it if already there)
3. `git pull` to grab any remote updates
4. Read this file to remember where we paused
5. Invoke `/gsd-execute-phase 01-anti-bias-hardening` again — it should detect Streams A/B/C are done and pick up at Stream D

OR: directly dispatch a `gsd-executor` agent on T10 with the same operating rules used in Waves 1-3 (atomic commits, build-must-pass, tool-count probe, conventions per `.planning/codebase/CONVENTIONS.md`).

## Deferred items (during Phase 01)

See `.planning/phases/01-anti-bias-hardening/deferred-items.md` for the full list. Notable:
- **D-01** — `guessPricingUrl` strips `www.` causing Wayback host mismatch (find-pricing-anchors.ts). Out of scope for H8 fix. M-level.
- **D-T04-1** — YC RFS mislabeled as `independent`, should be `conflicted` per spec §4 rule 6. **Owner: T10** (Stream D pickup).
- **D-T04-2** — read-competitor-changelog mislabels competitor self-hosted changelog/site-search as `independent`, should be `conflicted`. Owner: future M-series tool-quality phase.
