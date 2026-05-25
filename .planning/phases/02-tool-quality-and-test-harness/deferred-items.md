# Phase 02 — Deferred Items

Items discovered during Phase 02 execution that are not in-scope for this phase
but must be tracked. Each entry records: what, why deferred, what unblocks it.

---

## D-T07-1 — Product Hunt Topics API may be unavailable on standard auth scope

**Discovered during:** T07 (Add PH topics API resolution in `lib/producthunt.ts`)

**Issue:** The `resolveTopicSlug(category)` helper queries the PH GraphQL
`topics(query: $q, first: 5)` field. The PH GraphQL schema may reject the
call with one of:

  - `"not authorized"` — the standard Developer API key may not include the
    scope required to read topic metadata.
  - `"unknown field"` — the field may be gated behind PH's Partner / Pro tier.

**Behavior:** `resolveTopicSlug` catches both shapes (`response.ok === false`
and `data.errors[]` non-empty) and returns `null`. The caller
(`scan_producthunt_launches` after T08) falls back to the legacy
`searchProductHunt(query, first)` query-by-string path and surfaces the gap
explicitly in `confidence_note` per spec §11 anti-pattern 2 — no silent
failure.

**What unblocks resolution:**

  1. Run the topics query against a live PH GraphQL endpoint with a valid
     `PRODUCTHUNT_API_KEY` and capture the exact error shape (if any).
  2. If the error is auth-scope related, evaluate whether the PH OAuth /
     Partner program grants the required scope, and at what cost.
  3. If the field is genuinely unavailable, leave the fallback path as the
     permanent behavior and update CONCERNS.md M6 to reflect that the
     fallback is the production path, not a temporary workaround.

**Files touched by the fallback contract:**

  - `src/lib/producthunt.ts` — `resolveTopicSlug`, `searchPostsByTopic`
  - `src/tools/scan-producthunt-launches.ts` — fallback wiring + honest
    `confidence_note` (T08)

**Spec compliance:** §7 graceful degradation, §11 anti-pattern 2, CONCERNS.md M6.
