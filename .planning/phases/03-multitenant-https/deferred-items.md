# Phase 03 — Deferred Items

Items discovered during Phase 03 execution (or settled at PLAN-CHECK time) that
are not in-scope for this phase but must be tracked. Each entry records: what,
why deferred, what unblocks it. Cross-referenced from
`.planning/codebase/CONCERNS.md` "Phase 03 Deferred Items" section.

**Branch nomenclature:** Phase 03 shipped from `phase-v3` → `main`. Future phases
use `phase-vN`.

---

## D-03-1 — Cache hit-rate instrumentation deferred

**Discovered during:** T22 (enrich `/health` with subsystem fields).

**Issue:** `/health` returns `cache_hit_rate: null` because `src/lib/cache.ts`
has no hit/miss counters. T22 wired the field but left it null pending
instrumentation.

**Behavior:** The Phase 02 cache wiring (cold 11.7s → warm 0ms across 6
orchestrator tools — see CONCERNS.md M8 RESOLVED note) works correctly. The
gap is purely observability: a future refactor that accidentally bypasses the
cache wouldn't be visible from `/health` until users complained about response
times.

**What unblocks resolution:**

  1. Add `hits` + `misses` counters to `src/lib/cache.ts`'s `get`/`set` paths.
  2. Export `cacheStats(): { hits, misses, hit_rate }`.
  3. Wire into `src/http/server.ts`'s `/health` handler so the
     `cache_hit_rate` field returns a real number between 0 and 1.

**Files touched (if/when resolved):**

  - `src/lib/cache.ts` — add counters + `cacheStats` export.
  - `src/http/server.ts` — health handler reads `cacheStats()`.

**Spec compliance:** CONTEXT.md Stream E success criterion (observability);
PLAN.md T22 acceptance note ("Phase 04 candidate").

---

## D-03-1-a — Global Serper cap = graceful degradation, NOT a 429 from the HTTP layer

**Discovered during:** PLAN-CHECK v0.1 → v0.2 (concern C7 disposition).

**Issue:** When the 1,500-call UTC-day global Serper cap fires, downstream
tools surface `fallbacks_used: ['serper_global_cap']` in the response envelope
(plus source tier → D, bias → unknown — same shape as when the API key is
absent). The HTTP layer returns **200**, NOT 429. 429 is reserved exclusively
for the **per-token** cap (T11/T13).

**Behavior (by design):** Honors spec §11 anti-pattern 2 ("Never fail
silently — gap surfaced honestly in `fallbacks_used` + `confidence_note`")
plus §7 graceful degradation. The trade-off: there is no HTTP-status signal
that the global cap fired; admin observability comes from log greps
(`serper_global_cap` event) and the response envelope.

**What unblocks resolution (only if revisited):**

  1. Operational signal that the log-grep / envelope-inspection path is
     insufficient for production observability.
  2. Decide whether to add `X-Vetoed-Global-Cap-Hit: true` as an advisory
     response header OR expose `GET /admin/api/serper-status` to surface
     today's count.
  3. **Do NOT change the 200-status semantics** — that contract is locked in
     v0.2; downstream consumers (LLMs orchestrating `validate_idea`) rely on
     the structured fallback signal and would break if the status flipped.

**Files touched by the locked contract:**

  - `src/lib/serper.ts` — graceful-degradation site, emits
    `fallbacks_used: ['serper_global_cap']`.
  - `src/ratelimit/global.ts` — cap check (UTC-day window).
  - `src/ratelimit/middleware.ts` — explicitly does NOT pre-check the global
    cap; per-token cap only.

**Spec compliance:** §11 anti-pattern 2, §7 graceful degradation, CONTEXT.md
decision 2 (v0.2).

---

## D-03-2 — Token prefix is the first 7 chars (`pv_xxxxx`), not the last 4

**Discovered during:** PLAN-CHECK v0.1 → v0.2 (concern C8 disposition).

**Issue:** CONTEXT.md v0.1 said "last 4 chars" for the stored token prefix.
v0.2 settles on **first 7 chars** so the `pv_` discriminator is preserved in
the prefix AND the prefix is grep-friendly (`grep pv_a1b2c logs/*` finds a
specific token's audit trail across pino JSON logs).

**Behavior:** `issueToken` stores `token_prefix = rawToken.substring(0, 7)`
(or `.slice(0, 7)`); `listTokens` returns the same. `revokeToken(idOrPrefix)`
accepts both numeric id and `pv_xxxxx` prefix. The contract is enforced by
the grep-lock in T06 acceptance:
`grep -nE "substring\(0,\s*7\)|slice\(0,\s*7\)" src/auth/tokens.ts` returns
≥1 match.

**What unblocks resolution:** Nothing — settled in v0.2. No tokens were
issued under v0.1's "last 4" rule (schema landed at v0.2 already). This
entry documents the decision so a future reader doesn't try to "fix" the
prefix to match an out-of-date plan or doc.

**Files touched by the locked contract:**

  - `src/auth/tokens.ts` — prefix-extraction + return shape.
  - `src/db/schema.sql` — `token_prefix TEXT NOT NULL` (no length CHECK
    so future iteration is possible; the 7-char shape is a contract at the
    application layer).
  - `scripts/admin.ts` — `list-tokens` table column width.

**Spec compliance:** CONTEXT.md decision 1 v0.2.

---

## D-03-3 — Single-region deploy; multi-region deferred

**Discovered during:** CONTEXT.md decision 3 (Fly.io hosting, "One region to
start (probably IAD or LHR)").

**Issue:** Phase 03 ships from a single Fly region — `primary_region = "iad"`
in `fly.toml`. Users in Europe / APAC will see ~100–200ms additional latency
on every `tools/call`.

**Behavior:** Latency is acceptable for `validate_idea` (multi-second
LLM-orchestrated runtime — single-region overhead is noise relative to the
total). For lighter standalone `tools/call` invocations it's noticeable but
not blocking.

**What unblocks resolution:**

  1. User feedback signal: latency complaints from non-North-American users.
  2. Decision: SQLite replication via LiteFS (cheap, single-write-region
     limitation) OR migrate persistence to Postgres + Fly's managed
     Postgres with read replicas (more capable, more work).

**Files touched (if/when resolved):**

  - `fly.toml` — `primary_region` + region list.
  - `src/db/connection.ts` — possibly swap better-sqlite3 for a Postgres
    client.
  - `docs/OPERATIONS.md` — region rotation runbook.

**Spec compliance:** CONTEXT.md decision 3 ("until latency complaints
emerge"); Phase 03 Out-of-Scope ("Multi-region Fly deploy").

---

## D-03-4 — Tool-call-level rate limit (vs prompt-level); T11 threshold = 400 calls/day

**Discovered during:** PLAN-CHECK v0.1 → v0.2 (concern C6 disposition).

**Issue:** The MCP server cannot observe a "prompt invocation" — prompts are
LLM-side orchestration; only `tools/call` requests cross the wire to the
HTTP server. So the per-token rate limit is enforced at the tool-call layer,
not the prompt layer.

**Behavior (math, documented verbatim in `src/ratelimit/per-token.ts` file
header AND `docs/HOSTED_SETUP.md` Section 4):**

  - User-facing budget: 20 `validate_idea` runs / day / token (CONTEXT.md
    decision 2).
  - Spec §11 DoD tool-call budget: ≤20 tool calls per `validate_idea`
    (UPPER bound).
  - Worst case per-token tool calls: 20 runs × 20 tool calls = **400 / day**.
  - Typical case: 20 runs × ~13 tool calls ≈ 260 / day.
  - A user hitting the 400-call ceiling has usually run ~30 typical
    validations (400 / 13 ≈ 30) — well past the 20-run guarantee. The
    user-facing headline ("~20 runs/day, guaranteed even at spec-max
    budget") holds.

**What unblocks resolution (only if revisited):**

  1. User feedback that the tool-call ceiling maps awkwardly to the
     user-visible run budget (e.g., a power user routinely hits 400 calls
     mid-month and complains about the daily reset granularity).
  2. Add a `validate_idea`-completion sentinel signal (e.g., a final
     `tools/call` to `finalize_validation_report` triggers a per-run
     counter increment) and rate-limit at both layers.
  3. Add `X-Vetoed-Runs-Remaining` advisory header so users can see the
     run-budget vs the tool-call-budget separately.

**Files touched by the locked behavior:**

  - `src/ratelimit/per-token.ts` — file-header math comment + 400-call
    threshold.
  - `docs/HOSTED_SETUP.md` Section 4 — user-facing explanation.
  - `src/ratelimit/middleware.ts` — wires the check on `POST /mcp`.

**Spec compliance:** CONTEXT.md decision 2 (per-token rate limit); §11 DoD
tool budget (≤20 per run, UPPER bound).

---

## D-03-5 — Self-serve email-collection form vs mailto CTA

**Discovered during:** CONTEXT.md decision 4 (Stream F1 landing) + R7
(minimum-viable copy).

**Issue:** Landing page CTA is
`<a href="mailto:aljosa@getvetoed.com?subject=Vetoed%20access%20request">Request access</a>`
— no in-page form, no automation.

**Behavior:** Manual admin step per signup. The runbook (`docs/OPERATIONS.md`
T24) covers it:

  1. User emails `aljosa@getvetoed.com`.
  2. Aljosa runs `flyctl ssh console -a vetoed-mcp` → inside the
     container, `cd /app && npm run admin -- issue-token --email=<user>`.
  3. Aljosa emails the `pv_<…>` token back to the user.
  4. User adds it to `~/Library/Application Support/Claude/claude_desktop_config.json`
     per `docs/HOSTED_SETUP.md`.

Acceptable at v1 user volume (≤50 users per CONTEXT.md OAuth gating
threshold).

**What unblocks resolution:**

  1. User count > 50 OR Aljosa decides manual issue is friction-blocking.
  2. Pick a route: OAuth 2.1 / Google sign-in (CONTEXT.md OOS bullet 1) OR
     magic-link email flow (lighter, no third-party SSO dependency).
  3. Build:
     - Public token-request form on the landing page.
     - Email-verification endpoint.
     - Token-issue automation (reuses T06 `issueToken`).
     - Token-display page (one-time render with copy-to-clipboard).

**Files touched (if/when resolved):**

  - `public/index.html` — replace mailto with form.
  - `src/http/server.ts` — new `POST /signup` route (rate-limited, email-validated).
  - `src/auth/tokens.ts` — reused (`issueToken` is already the right shape).
  - New email-sending integration (e.g., Resend / SES / Postmark).

**Spec compliance:** CONTEXT.md Out-of-Scope bullet 4 ("Self-serve token
request UX — mailto CTA is v1").

---

## D-03-6 — `bin.weather` scaffold leftover in `package.json`

**Discovered during:** PLAN-CHECK v0.1 → v0.2 (OQ3 resolution).

**Issue:** `package.json` contains:

```json
"bin": {
  "weather": "./build/index.js"
}
```

This is a Phase 00 scaffold leftover from the initial weather-MCP demo. The
package's actual purpose is product-idea validation, not weather; the
`weather` bin name is misleading.

**Behavior:** Cosmetic only. Claude Desktop configs use the absolute path of
`build/index.js`, NOT the `bin` alias, so the leftover doesn't break
anything in practice. `npm install -g .` would install a `weather` command,
which is wrong — but we don't publish to npm (Phase 03 ships as a hosted
HTTPS service, not a globally-installed CLI), so the broken local-bin shape
is never exercised.

**What unblocks resolution:** Phase 04 cleanup pass on `package.json`.

  1. Rename `bin.weather` → `bin.vetoed-mcp` (or remove entirely if not
     publishing to npm).
  2. Update `docs/HOSTED_SETUP.md` Section 5 (stdio fallback) if the
     canonical local invocation changes.
  3. If renaming, bump the package version + add a CHANGELOG note so any
     downstream user of the bin (none expected) sees the rename.

**Files touched (if/when resolved):**

  - `package.json` — `bin` field.
  - `docs/HOSTED_SETUP.md` — Section 5 (stdio fallback config).

**Spec compliance:** Phase 03 Out-of-Scope bullet 11 ("`bin.weather`
cleanup — `package.json` scaffold leftover; Phase 04 (D-03-6)").
