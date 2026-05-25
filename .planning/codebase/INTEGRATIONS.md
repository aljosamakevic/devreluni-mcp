# External Integrations

**Analysis Date:** 2026-05-20

This document catalogs every external integration the ProductValidation MCP touches, mapped against the spec's source-tier and bias-flag system (`.planning/spec/build-spec-v1.0.md` §4) and the standard tool result envelope (§7). Tier assignments here are the **tool-layer defaults** — per spec Appendix B §3, tier and bias are assigned at the tool layer, never the prompt layer.

## The `ToolResult<T>` envelope (spec §7)

Every tool — regardless of which integrations it calls — returns:

```typescript
// src/types.ts:1-14
interface ToolSource {
  url: string;
  tier: 'S' | 'A' | 'B' | 'C' | 'D';
  bias: 'independent' | 'vendor-funded' | 'conflicted' | 'unknown';
  fetched_at: string;       // ISO timestamp
  contribution: string;     // one-line summary of what this source contributed
}

interface ToolResult<T> {
  data: T;                  // tool-specific structured payload
  sources: ToolSource[];    // every URL that informed `data`
  confidence_note: string;  // caveats; mentions fallbacks if any
  fallbacks_used: string[]; // paid APIs that degraded to free sources
}
```

Per spec §7, "If a paid API key isn't configured, tool falls back to free sources and lowers confidence rating in `confidence_note`. Never fail silently." This is implemented uniformly: each integration wrapper exposes `isXxxLive()` and stub generators; each tool pushes a human-readable string into `fallbacks_used[]` when a paid path drops to a stub.

Per spec §4 source tier definitions (verbatim):
- **S** — Primary, first-party, immutable (changelogs, SEC filings, Wayback snapshots, ToS, GitHub commits, live pricing pages for price only)
- **A** — Strong secondary, user-generated at scale (IndieHackers, Reddit subscriber counts, Product Hunt metrics, founder MRR tweets, SimilarWeb, Ahrefs)
- **B** — Aggregated user feedback, pattern-rich, individually weak (G2/Capterra reviews of 50+, App Store review patterns, HN comment themes)
- **C** — Vendor-funded research (Gartner, Forrester, IDC, "State of X" reports)
- **D** — Marketing material, anonymous opinion (vendor landing-page claims, anonymous forum comments, single Reddit posts with no engagement)

Per §4 bias flags:
- **independent** — no financial/organizational stake
- **vendor-funded** — paid by category participant
- **conflicted** — direct stake (competitor, partner, investor, employee) — positioning evidence only
- **unknown** — couldn't determine, **treated as `vendor-funded` for confidence math** (§4 rule 4 + §11 anti-pattern)

## APIs & External Services

### Serper (Google Search) — paid, live-or-stub

- **Wrapper:** `src/lib/serper.ts`
- **Public surface:** `serperSearch(query, num)` → `SerperOrganicResult[]`; `isSerperLive()`; `serperSource(query)` → `ToolSource`; `serperConfidenceNote()` → string; `getSerperStub(query)` → marked stub results.
- **Env var:** `SERPER_API_KEY`
- **Endpoint:** `POST https://google.serper.dev/search` (`src/lib/serper.ts:15`)
- **Live/stubbed status:** Live when key is present. Without key, returns two `[STUB]`-prefixed results and the calling tool pushes `'serper (stub — set SERPER_API_KEY)'` into `fallbacks_used` (e.g., `src/tools/find-pricing-anchors.ts:126`, `src/tools/check-big-tech-encroachment.ts:254`).
- **Rate limits:** 2,500 free searches/mo on the free Serper tier (per `.env.example` comment). No retry/backoff implemented — failures degrade to stub via try/catch (`src/lib/serper.ts:39-42`).
- **Source tier classification per spec §4:**
  - Live: **tier A, bias `independent`** (`src/lib/serper.ts:71-72`). Justification: Serper indexes the open web; the *aggregate* of Google results is not first-party (so not S) but is a strong secondary signal at scale.
  - Stub: **tier D, bias `unknown`** (`src/lib/serper.ts:71-72`). Justification: per §4 row D ("Marketing material, anonymous opinion") and rule "default to more cautious labels when uncertain" (§4 bottom). `unknown` bias per §4 rule 4 = treated as vendor-funded downstream.
  - Note: when Serper is used to scope a `site:reddit.com` or `site:g2.com` query, the *consuming wrapper* (e.g., `redditSource()`) overrides tier per the domain being indexed, not the Serper default.

### Product Hunt v2 GraphQL — paid, live-or-stub

- **Wrapper:** `src/lib/producthunt.ts`
- **Public surface:** `searchProductHunt(query, first)` → `PHPost[]`; `isPHLive()`; `phSource(query)` → `ToolSource`; `phConfidenceNote()`.
- **Env var:** `PRODUCTHUNT_API_KEY`
- **Endpoint:** `POST https://api.producthunt.com/v2/api/graphql` with `Authorization: Bearer <key>` (`src/lib/producthunt.ts:16, 47-49`)
- **Live/stubbed status:** Live when key is present. Without key (or on any non-2xx / parse failure), returns a single `[STUB]` post and downstream tools push fallback. No retry/backoff; failure modes silently degrade to stub via catch (`src/lib/producthunt.ts:89-91`).
- **Rate limits:** Not enforced in code. Product Hunt's documented limits apply at the API.
- **Source tier classification per spec §4:**
  - **Tier A, bias `independent`** (`src/lib/producthunt.ts:119-120`). Justification: §4 row A explicitly lists "Product Hunt metrics" — upvotes/comments are user-generated at scale.
  - Bias remains `independent` even though the *posts themselves* are submissions by founders (which would be conflicted), because the **metrics** (`votesCount`, `commentsCount`) are the signal — and those are aggregated independent behavior. If a tool extracts a tagline as a *claim*, the tool must re-tag that fact as `conflicted` at its own layer per §4 bias-flag rule 6.

### Hacker News (Algolia search index) — free, always-live

- **Wrapper:** `src/lib/hn.ts`
- **Public surface:** `searchHN(query, hitsPerPage)` → `HNHit[]`; `hnSource(query)` → `ToolSource`. No `isHNLive()` because the endpoint is free and unauthenticated.
- **Endpoint:** `GET https://hn.algolia.com/api/v1/search?query=...&tags=story` (`src/lib/hn.ts:28, 41`)
- **Live/stubbed status:** Always live (no key needed). On any error, returns `[]` and logs to stderr (`src/lib/hn.ts:51-55`); no stub — empty array is honest because HN is free and a failure means a real outage.
- **Caching:** TTL.MEDIUM (1 hr) in-memory via `src/lib/cache.ts` (`src/lib/hn.ts:32-34, 51`). HN data is slow-moving relative to a workflow run.
- **Rate limits:** Algolia's public limit (~10k req/hour per IP). No enforcement in code.
- **Source tier classification per spec §4:**
  - **Tier A, bias `independent`** (`src/lib/hn.ts:60-62`). Justification: §4 row A ("user-generated at scale"). HN threads aggregate practitioner discussion; story-level metadata is high-signal. Individual comment *themes* would be tier B (pattern-rich aggregated themes) — when a tool extracts comment themes vs. story metadata, the consuming tool should re-tier accordingly.

### Reddit (via Serper `site:reddit.com`) — divergence from spec

- **Wrapper:** `src/lib/reddit.ts`
- **Public surface:** `searchReddit(query, limit)` → `RedditSearchResult`; `isRedditLive()` (delegates to `isSerperLive()`); `redditSource(query)`; `redditConfidenceNote()`.
- **Env var:** `SERPER_API_KEY` (same as Serper — no separate Reddit credential).
- **Endpoint:** Routed through `serperSearch(\`${query} site:reddit.com\`)` at `src/lib/reddit.ts:60-62`.
- **Live/stubbed status:** Live iff Serper is live. Reddit-domain results are filtered, IDs and permalinks are extracted heuristically from URLs (`src/lib/reddit.ts:36-56`).
- **Source tier classification per spec §4:**
  - **Tier B, bias `independent`** (`src/lib/reddit.ts:90-93`). The wrapper file's header comment (`src/lib/reddit.ts:1-15`) is explicit and honest about this being a deliberate downgrade.
- **Used by:** `src/tools/map-competitive-weaknesses.ts`, `src/tools/get-category-failure-modes.ts`.

#### Reddit refactor divergence from spec

**Spec implies tier A Reddit data via official API.** Per spec §4 row A: "Reddit subscriber counts" are an A-tier signal. The build spec was written assuming OAuth Reddit API access — subscriber counts, posting activity, comment threads, scores, vote counts. That data is tier A because it's first-party-at-scale platform metrics.

**Reality routes through Serper `site:reddit.com`.** The implementation chose not to integrate Reddit OAuth. The header comment at `src/lib/reddit.ts:1-15` documents the trade-off explicitly:

> *"Reddit gates app creation aggressively (Responsible Builder Policy); for our use case (surfacing pain-point quotes from competitor discussions), Google's index of Reddit captures the signal we need without auth."*

**What we lose vs. spec (per file header):**
- Snippets only — no full comment threads
- `score` / `num_comments` not available — hard-coded to `0` (`src/lib/reddit.ts:71-73`)
- Subreddit name extracted heuristically from URL (`src/lib/reddit.ts:38-41`); `created_utc` and `author` set to `0` / `'unknown'`
- **No subscriber counts** — the specific evidence type spec §4 cites as A-tier

**What we gain:**
- Zero Reddit credentials to manage
- One less integration in the stack (Serper already required)
- Honest tier downgrade rather than mis-labeled A-tier data

**Tier impact: A → B.** Per spec §4 row B ("aggregated user feedback, pattern-rich, individually weak — HN comment threads (themes)"), Reddit-via-SERP fits B better than A: we get *themes from snippets*, not first-party metrics. The wrapper correctly assigns tier B at `src/lib/reddit.ts:90-93`.

**Downstream consequence per spec §3 / §6.1 verdict math:** Spec §6.1 OPERATING RULE 4 requires "PASS requires ≥2 tier-B-or-higher sources". B still qualifies, so Reddit evidence can still *validate* a gate — but it can no longer **anchor** a gate's demand-signal evidence (e.g., spec §9 Gate 2's "subreddit 10k+ subs (B2B) or 100k+ (B2C)" — an A-tier signal in spec) because the subscriber count is unavailable through SERP snippets. Tools currently using Reddit (`src/tools/map-competitive-weaknesses.ts`, `src/tools/get-category-failure-modes.ts`) compensate by sourcing demand-volume signals from HN (tier A) and Product Hunt (tier A).

**If a future tool needs A-tier Reddit data** — notably the planned `estimate_demand_signals` (spec §7 P0), which explicitly calls out "Reddit subscriber counts" as A-tier output — the choice is either (a) integrate OAuth Reddit properly and upgrade `redditSource()` tier, or (b) document the gap in `confidence_note` and downgrade the gate's confidence per §4 rule 2 (>30% conflicted/uncertain → downgrade one level).

### Direct web fetch (pricing pages, Wayback references) — free, always-live

- **Wrapper:** `src/lib/webfetch.ts`
- **Public surface:** `fetchPage(url)` → `{ url, status, text, ok }`; `stripHtml(html)`; `guessChangelogUrls(domain)` → string[].
- **Endpoint:** `fetch(url)` with a polite UA `Mozilla/5.0 (compatible; product-validation-mcp/0.1.0)` (`src/lib/webfetch.ts:11`)
- **Used by:** `src/tools/find-pricing-anchors.ts` (live pricing pages), `src/tools/read-competitor-changelog.ts` (changelogs)
- **Source tier classification per spec §4:**
  - Live competitor pricing page → **tier S, bias `conflicted`** (`src/tools/find-pricing-anchors.ts:140-147`). Justification: §4 row S explicitly lists "live pricing pages (for price only)"; §4 bias rule 6 says "competitor sources are valid only as positioning evidence — what they CLAIM, not what is TRUE" → bias `conflicted`.
  - Wayback Machine reference URL → **tier S, bias `independent`** (`src/tools/find-pricing-anchors.ts:152-159`). Wayback is an immutable third-party archive; the snapshot is first-party content but the archive itself is independent.
  - Changelogs fetched from competitor domain → tier S, bias `conflicted` (same logic as pricing — first-party self-report, used as positioning/velocity evidence).

## Data Storage

**Databases:** None.

**File Storage:** Local filesystem only — the three static resource markdown files under `src/resources/` are read fresh per request (`src/index.ts:41-43`, per spec Appendix B §1).

**Caching:**
- In-memory `Map` cache at `src/lib/cache.ts` with TTL constants `SHORT` (5 min), `MEDIUM` (1 hr), `LONG` (24 hr).
- Currently used only by `src/lib/hn.ts` for HN Algolia query dedup. Per spec Appendix B §2, "Cache is fine for tool results within a single workflow run" — the cache lives in-process and is wiped on server restart, which aligns.

## Authentication & Identity

None. The MCP server has no users — it's a single-tenant subprocess spawned by an MCP host. All "auth" is API keys to outbound integrations, loaded from `.env` at startup (`src/index.ts:13-16`).

## Monitoring & Observability

**Error Tracking:** None. Errors are logged to `stderr` (`console.error`) — critically, **never to stdout**, because stdio is the JSON-RPC channel (see `src/index.ts:13-16` comment and `src/lib/serper.ts:39-42`).

**Logs:** `console.error` to stderr. The MCP host (Claude Desktop, etc.) typically captures stderr to a log file.

## CI/CD & Deployment

**Hosting:** None. The server runs as a subprocess of the MCP host (Claude Desktop / Cursor / Claude Code). The host launches `build/index.js` directly.

**CI Pipeline:** None configured.

**Distribution:** `bin: "weather"` in `package.json:8` (legacy name from the project's scaffolding origin — should be renamed; see CONCERNS.md). Intended to be `npx`-able.

## Environment Configuration

**Required env vars (all optional — server runs with stubs):**

| Var | Required? | Used by | Tier when live | Tier when stubbed |
|---|---|---|---|---|
| `SERPER_API_KEY` | optional (degrades to stub) | `src/lib/serper.ts`, `src/lib/reddit.ts` (indirectly) | A (web) / B (Reddit) | D / N/A |
| `PRODUCTHUNT_API_KEY` | optional (degrades to stub) | `src/lib/producthunt.ts` | A | N/A (single stub post) |
| `GITHUB_TOKEN` | optional (not yet consumed) | reserved for upcoming `estimate_demand_signals` (spec §7 P0) | S (commits, stars) | — |

**Secrets location:** `.env` at project root, gitignored. `.env.example` committed as template.

**Critical implementation note:** `dotenv` is loaded with `quiet: true` (`src/index.ts:13-16`) because dotenv v17+ logs to stdout by default, which **corrupts the MCP stdio JSON-RPC channel**. Any future dotenv-equivalent must respect the same constraint.

## Webhooks & Callbacks

None. The MCP server is purely request-response over stdio.

## Spec-to-integration alignment summary

| Spec requirement (§) | Integration enforcement |
|---|---|
| §4 every fact has tier + bias | `ToolSource` interface (`src/types.ts:1-7`) makes both required; per-integration `*Source()` helpers assign them at the wrapper layer |
| §4 rule 4 — `unknown` bias treated as vendor-funded | Stub Serper sources use `bias: 'unknown'` and rely on §4 rule 4 at the prompt layer; never silently upgraded to `independent` (per §11 anti-pattern) |
| §7 standard `{ data, sources, confidence_note, fallbacks_used }` shape | `ToolResult<T>` (`src/types.ts:9-14`); every tool returns this exact shape |
| §7 "never fail silently" | Every wrapper has try/catch → stub fallback + explicit `fallbacks_used` entry + degraded `confidence_note` |
| §11 anti-pattern "Soft-failing tool calls (returning made-up data when the API fails)" | All stubs are `[STUB]`-prefixed; never indistinguishable from real data |
| Appendix B §3 "Tier and bias must be assigned at tool layer, not prompt layer" | All `*Source()` helpers in `src/lib/` — prompts only consume, never construct sources |

---

*Integration audit: 2026-05-20*
