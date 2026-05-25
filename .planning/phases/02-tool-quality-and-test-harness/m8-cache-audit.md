# M8 Cache Audit (2026-05-25)

## Library-layer cache status (verified by `grep -c cacheGet|cacheSet src/lib/*.ts`)

| Library | Internal cache? | Notes |
|---|---|---|
| `src/lib/serper.ts` | NOT-CACHED | Every `serperSearch` is a fresh HTTP call. Highest leverage for tool-layer caching. |
| `src/lib/wayback.ts` | NOT-CACHED | Each `waybackLookup` re-queries the CDX API. |
| `src/lib/webfetch.ts` | NOT-CACHED | Bare `fetch` wrapper. |
| `src/lib/github.ts` | LIB-CACHED (5 hits) | Repo metadata, stars, releases cached internally. |
| `src/lib/hn.ts` | LIB-CACHED (3 hits) | Algolia results memoized. |
| `src/lib/reddit.ts` | LIB-CACHED (3 hits) | Permalink + subreddit metadata cached. |
| `src/lib/producthunt.ts` | LIB-CACHED (4 hits) | Topic ID + post search cached. |
| `src/lib/competitor-domain.ts` | LIB-CACHED (6 hits) | T02's `competitor → hostname` map at TTL.LONG. |
| `src/lib/bias.ts` | n/a | Pure function. |
| `src/lib/recency.ts` | n/a | Pure function. |
| `src/lib/category-platform-features.ts` | n/a | Static data. |
| `src/lib/platform-keywords.ts` | n/a | Static data. |

## Tools that should get tool-layer caching (RECOMMEND — 6)

These tools fan out to **uncached** libraries (Serper, wayback, webfetch) and/or
compose 4+ library calls per invocation. Caching the WHOLE tool result avoids
redundant `Promise.allSettled` fan-out on repeat invocation within a session.

- **`find_pricing_anchors`** — multi-competitor fan-out (resolveCompetitorDomain + Serper site search + webfetch + wayback per competitor; ~5 Serper + 5 webfetch calls for 5 competitors). **TTL.SHORT** (5 min).
- **`check_big_tech_encroachment`** — 8+ Serper hyperscaler/conference queries fan-out. **TTL.SHORT**.
- **`find_why_now_signals`** — hyperscaler doc searches + regulatory site searches (uncached Serper). **TTL.SHORT**.
- **`estimate_demand_signals`** — composes GitHub (cached) + Reddit (cached) + Serper (uncached) — Serper layer benefits from outer wrap. **TTL.SHORT**.
- **`find_public_revenue_signals`** — 4 Serper site filters per competitor (TechCrunch / Crunchbase / SEC / general). **TTL.SHORT**.
- **`assess_platform_dependency`** — multi-platform ToS + retrospective fan-out via Serper + webfetch. **TTL.SHORT**.

## Tools already library-cached or pure (SKIP — 7)

- **`find_closest_competitor`** — single Serper call; tool-layer wrap = marginal benefit (one call avoided per re-run).
- **`read_competitor_changelog`** — webfetch + Serper, but result is conflicted-evidence object; per-invocation framing differences make caching less safe. SKIP.
- **`find_yc_rfs_alignment`** — pure static keyword matching, no fetches.
- **`get_category_failure_modes`** — static category map lookup.
- **`map_competitive_weaknesses`** — composes outputs of OTHER tools (which are themselves wrapped); double-wrapping not beneficial.
- **`scan_producthunt_launches`** — PH lib is LIB-CACHED at TTL.MEDIUM; tool wrap = double cache, low marginal value.
- **`finalize_validation_report`** — pure renderer, no fetches.

## TTL strategy

- Tool-layer wrapping uses **TTL.SHORT (5 min)** uniformly. Within a session, repeated invocations of the same tool with the same normalized args return instantly.
- Inner lib caches (competitor-domain TTL.LONG = 24h, GitHub/Reddit/PH/HN internal TTL) persist beyond outer expiry — so when the outer 5-min cache expires, the inner cache still serves the expensive parts (e.g. domain resolution) from a single Serper call.
- This two-tier design is intentional: outer cache = fast-path for iterative back-to-back runs; inner cache = long-term quota saver.

## Decision for T12

Wire tool-layer cache into the **6 RECOMMEND tools**. Use `TTL.SHORT` and `makeCacheKey('<tool_name>', ...normalizedArgs)` where normalization lowercases + trims strings and sorts array args.
