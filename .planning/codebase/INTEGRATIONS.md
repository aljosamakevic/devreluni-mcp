# External Integrations

**Analysis Date:** 2026-05-20

## Overview

The ProductValidation MCP integrates with five external data sources (one of which is reused as a backdoor for a sixth). Every integration is wrapped in a single file under `src/lib/`, follows an env-var-driven graceful-degradation pattern (missing key → labeled stub data, never a thrown error), and produces a `ToolSource` record that is folded into the `ToolResult<T>` envelope returned by every tool.

A sixth integration — GitHub — is declared in `.env.example` but **not yet wired** to any tool code.

## The `ToolResult<T>` Envelope

Defined in `src/types.ts`. Every tool in `src/tools/*.ts` returns this shape (wrapped as JSON inside an MCP `text` content block):

```ts
// src/types.ts
export interface ToolSource {
  url: string;
  tier: 'S' | 'A' | 'B' | 'C' | 'D';
  bias: 'independent' | 'vendor-funded' | 'conflicted' | 'unknown';
  fetched_at: string;       // ISO 8601
  contribution: string;     // human-readable: what this source contributed
}

export interface ToolResult<T> {
  data: T;                          // tool-specific payload
  sources: ToolSource[];            // every URL that contributed
  confidence_note: string;          // "live" vs. "stubbed — set X_API_KEY"
  fallbacks_used: string[];         // e.g. ["serper_unavailable", "ph_stubbed"]
}
```

**Tier semantics** (see `src/resources/source-tier-bias.md` for the canonical rubric):
- `S` — primary, authoritative (e.g. SEC filings, official changelog HTML).
- `A` — first-party API (HN Algolia, Product Hunt GraphQL, live Serper SERP).
- `B` — aggregated snippet / proxy (Reddit-via-Serper falls here).
- `C` — secondary commentary.
- `D` — stubbed / placeholder / unknown.

The tier downgrades automatically when an integration is in stub mode (see each section below).

## APIs & External Services

### 1. Serper (Google Search)

- **Wrapper:** `src/lib/serper.ts`
- **Env var:** `SERPER_API_KEY` (sent as `X-API-KEY` header)
- **Endpoint:** `POST https://google.serper.dev/search` with body `{ q, num }`
- **Live / stubbed:** Live iff `SERPER_API_KEY` is set; otherwise `getSerperStub()` returns 2 results with titles prefixed `[STUB]`.
- **Source tier:** `A` (independent) when live → `D` (unknown) when stubbed. See `serperSource()`.
- **Rate limits:** 2,500 free searches/month (per `.env.example`). No client-side throttling or caching in `serper.ts`.
- **Used by tools:**
  - `src/tools/find-closest-competitor.ts`
  - `src/tools/map-competitive-weaknesses.ts`
  - `src/tools/read-competitor-changelog.ts` (changelog discovery)
  - `src/tools/find-pricing-anchors.ts` (price history + reviews)
  - `src/tools/get-category-failure-modes.ts`
  - `src/tools/check-big-tech-encroachment.ts` (multiple sub-queries per call)
- **Failure mode:** Non-2xx response or thrown error → logs to stderr (`[serper.ts] serperSearch error:`) and falls back to stub. Tools should add `"serper_unavailable"` or `"serper_stubbed"` to `fallbacks_used`.

### 2. Reddit (via Serper, no Reddit credentials)

- **Wrapper:** `src/lib/reddit.ts`
- **Env var:** None directly. **Inherits `SERPER_API_KEY`** — `isRedditLive()` just returns `isSerperLive()`.
- **Endpoint:** Same as Serper. The wrapper appends `site:reddit.com` to the user's query and filters results to `link.includes('reddit.com')`.
- **Live / stubbed:** Live iff Serper is live.
- **Source tier:** **Hardcoded `B`** (independent) — explicit acknowledgement in the file header that snippets are aggregated, not first-party. Tier does **not** drop to `D` when stubbed (only the `contribution` text reflects stub state).
- **Rate limits:** Same Serper quota (one Serper call per Reddit search).
- **Why this design** (from comments in `src/lib/reddit.ts`):
  - Reddit gates OAuth app creation aggressively (Responsible Builder Policy).
  - The use case is pain-point quote surfacing — snippets are sufficient.
  - One less integration to maintain.
- **Tradeoffs (called out in code):**
  - ✓ Zero Reddit credentials.
  - ✗ Snippets only (no full comment threads).
  - ✗ `score`, `num_comments`, `created_utc` always `0`; `author` always `'unknown'`.
  - ✗ Subreddit is regex-extracted from the URL (`reddit.com/r/<name>`); falls back to `'unknown'`.
- **Used by tools:**
  - `src/tools/map-competitive-weaknesses.ts` (competitor complaints, switching language)
  - `src/tools/get-category-failure-modes.ts`

### 3. HN Algolia (Hacker News Search)

- **Wrapper:** `src/lib/hn.ts`
- **Env var:** **None** — public API, no auth.
- **Endpoint:** `GET https://hn.algolia.com/api/v1/search?query=...&hitsPerPage=...&tags=story`
- **Live / stubbed:** Always live. No stub path — failures return `[]` and log to stderr.
- **Source tier:** Hardcoded `A` (independent). See `hnSource()`.
- **Caching:** Uses the in-process cache from `src/lib/cache.ts` with `TTL.MEDIUM` (1 hour) — the only integration that caches.
- **Rate limits:** No published hard limit; HN Algolia is generous but not unlimited. No client-side throttling beyond cache.
- **Headers sent:** `User-Agent: product-validation-mcp/0.1.0`.
- **Used by tools:**
  - `src/tools/find-closest-competitor.ts`
  - `src/tools/map-competitive-weaknesses.ts`
  - `src/tools/get-category-failure-modes.ts`

### 4. Product Hunt (GraphQL v2)

- **Wrapper:** `src/lib/producthunt.ts`
- **Env var:** `PRODUCTHUNT_API_KEY` (sent as `Authorization: Bearer <key>`)
- **Endpoint:** `POST https://api.producthunt.com/v2/api/graphql`
- **Query:** Inline GraphQL `SearchPosts($query, $first)` selecting `id`, `name`, `tagline`, `url`, `votesCount`, `commentsCount`, `createdAt`, `topics`, `thumbnail`. Ordered by `VOTES`.
- **Live / stubbed:** Live iff `PRODUCTHUNT_API_KEY` is set; otherwise `getPHStub()` returns 1 labeled placeholder post. Any non-2xx or thrown error also falls back to stub.
- **Source tier:** Hardcoded `A` (independent) in `phSource()` — does **not** downgrade to `D` on stub; only the `contribution` text reflects stub state. (Inconsistent with `serperSource` behavior — see CONCERNS.)
- **Rate limits:** Per-application quota set by Product Hunt OAuth app; no client-side throttling.
- **Used by tools:**
  - `src/tools/find-closest-competitor.ts`
  - `src/tools/scan-producthunt-launches.ts`

### 5. Generic Web Fetch

- **Wrapper:** `src/lib/webfetch.ts`
- **Env var:** None.
- **Endpoint:** Any URL — uses platform `fetch` with `User-Agent: Mozilla/5.0 (compatible; product-validation-mcp/0.1.0)`, `Accept: text/html,application/xhtml+xml,text/plain`, `redirect: 'follow'`.
- **Live / stubbed:** Always live. Failures return `{ ok: false, status: 0, text: 'Fetch error: ...' }` rather than throwing.
- **Source tier:** Not assigned by `webfetch.ts` itself — each calling tool tags the fetched URL with its own tier (typically `S` for first-party changelog/pricing pages).
- **Helpers:**
  - `stripHtml(html)` — naive `<script>`/`<style>`/comment removal + entity decode + whitespace collapse.
  - `guessChangelogUrls(domain)` — yields `/changelog`, `/releases`, `/whats-new`, `/updates`, `/blog/changelog`, `/blog/releases`.
- **Used by tools:**
  - `src/tools/read-competitor-changelog.ts` (probes guessed URLs, then falls back to Serper-discovered URLs)
  - `src/tools/find-pricing-anchors.ts` (fetches `/pricing` and similar paths)
- **No robots.txt check, no rate limiting, no per-host throttle.**

### 6. GitHub (declared, not wired)

- **Wrapper:** None — there is no `src/lib/github.ts` file.
- **Env var:** `GITHUB_TOKEN` declared in `.env.example` with note: *"Needed by upcoming estimate_demand_signals tool."*
- **Status:** Documented intent only. `grep -rn "GITHUB_TOKEN\|api.github.com" src/` returns no hits. Treat as a future integration when implementing `estimate_demand_signals`.
- **Planned source tier:** Expected `A` (first-party API).

## Data Storage

**Databases:** None. The server is stateless.

**File Storage:** None. Static markdown under `src/resources/` is read at request time (per MCP spec — see comment in `src/index.ts` `loadResource()`).

**Caching:** In-process `Map` with TTL (`src/lib/cache.ts`). Currently only consumed by `src/lib/hn.ts`. TTLs: `SHORT` 5 min, `MEDIUM` 1 h, `LONG` 24 h. Cache is lost on every process restart.

## Authentication & Identity

**Auth provider:** None. The MCP server itself is unauthenticated — security model is "host spawns subprocess locally."

**Outbound auth:**
- Serper: `X-API-KEY` header.
- Product Hunt: `Authorization: Bearer <token>` header.
- HN Algolia: none.
- Web fetch: none.
- GitHub (planned): `Authorization: Bearer <token>` header expected.

## Monitoring & Observability

**Error tracking:** None (no Sentry, no Datadog).

**Logs:** `console.error` only (stderr) — see `src/index.ts` startup banners and per-integration error logs (e.g. `[serper.ts] serperSearch error:`, `[hn.ts] searchHN error:`). **Never `console.log`** — stdout is the JSON-RPC channel.

**Metrics:** None.

## CI/CD & Deployment

**Hosting:** Local subprocess only (stdio transport).

**CI pipeline:** None detected — no `.github/workflows/`, no `.gitlab-ci.yml`, no `circle`/`travis` config.

**Release:** `npm run build` produces `build/index.js` (chmod 755). No publish script.

## Environment Configuration

**Required env vars (all optional at runtime — server gracefully degrades):**
- `SERPER_API_KEY` — Serper + Reddit-via-Serper.
- `PRODUCTHUNT_API_KEY` — Product Hunt GraphQL.
- `GITHUB_TOKEN` — reserved for future `estimate_demand_signals` tool; currently unread.

**Loading:** `dotenv.config({ path: <pkg-root>/.env, quiet: true })` in `src/index.ts` (lines 13–16). `quiet: true` is critical — without it, dotenv v17+ writes `"injected env (N)"` to stdout and breaks JSON-RPC framing.

**Secrets location:** `.env` at package root, gitignored. `.env.example` is the contract; do not read or echo `.env` contents.

## Webhooks & Callbacks

**Incoming:** None — stdio transport, no HTTP listener.

**Outgoing:** None.

## Cross-Integration Notes & Caveats

- **`isRedditLive() === isSerperLive()`** — exhausting Serper quota silently degrades Reddit search to stub. Tools that use both should attribute fallbacks to Serper, not Reddit.
- **HN is the only no-key integration that genuinely "works empty"** — useful as a sanity-check signal even when other keys are missing.
- **Stub-tier downgrade is inconsistent:** `serperSource` drops tier `A → D` when stubbed, but `phSource` and `redditSource` keep their nominal tier and only reflect stub state in `contribution`. Consumers should rely on `confidence_note` and `fallbacks_used` rather than tier alone to detect stubbed runs.
- **Cache scope:** Only `hn.ts` uses the cache. Adding `cacheGet`/`cacheSet` around Serper and Product Hunt would directly reduce monthly quota burn.
- **Per-tool composition:** Tools fan out across 2–4 of these integrations and concatenate their `ToolSource[]` into the final `ToolResult<T>.sources`. See `src/tools/map-competitive-weaknesses.ts` (Serper + Reddit + HN) and `src/tools/find-closest-competitor.ts` (Serper + PH + HN) for canonical multi-source patterns.

---

*Integration audit: 2026-05-20*
