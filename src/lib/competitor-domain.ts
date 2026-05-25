import { serperSearch, isSerperLive } from './serper.js';
import { cacheGet, cacheSet, makeCacheKey, TTL } from './cache.js';

/**
 * Resolve a competitor name to its canonical pricing hostname via Serper.
 *
 * Per CONCERNS.md M2: blindly appending `.com` misses Forest (forestapp.cc),
 * Freedom (freedom.to), Cold Turkey (getcoldturkey.com), etc. We instead
 * ask Serper for `"<competitor> pricing"`, take the top organic hit's
 * hostname, and cache the mapping for 24h.
 *
 * Returns `null` when:
 *   - Serper is in stub mode (no SERPER_API_KEY), OR
 *   - Serper returns no usable organic results, OR
 *   - the top result's link is unparseable, OR
 *   - the top result points at example.com (stub fallback link).
 *
 * Callers MUST fall back to the legacy `<slug>.com` guess on null AND
 * note the fallback in `fallbacksUsed` / `confidence_note`.
 *
 * The TTL.LONG (24h) here is intentionally longer than the outer
 * `find_pricing_anchors` cache (TTL.SHORT, 5min, added by T12). Domain
 * resolution is stable across days, so re-runs within 24h cost zero
 * Serper quota for domain lookups even when the outer cache expires.
 */
export async function resolveCompetitorDomain(competitor: string): Promise<string | null> {
  // Direct URL input — parse the hostname out, preserving www. as part of
  // the canonical host (do NOT strip — D-01 fix).
  if (competitor.startsWith('http')) {
    try {
      const u = new URL(competitor);
      return u.hostname.replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  const cacheKey = makeCacheKey('competitor-domain', competitor);
  const cached = cacheGet<string | null>(cacheKey);
  if (cached !== null) return cached;

  // Serper stub mode → no usable resolution. Cache the null too so we don't
  // re-attempt within the TTL window.
  if (!isSerperLive()) {
    cacheSet(cacheKey, null, TTL.LONG);
    return null;
  }

  const results = await serperSearch(`${competitor} pricing`, 5);
  if (results.length === 0) {
    cacheSet(cacheKey, null, TTL.LONG);
    return null;
  }

  // Skip aggregator / review / discussion hosts — the top result for
  // "<product> pricing" is sometimes a Reddit thread or G2 page, which
  // would route the pricing probe at fetch time to a wrong domain.
  // Prefer the first organic hit that looks like a vendor site.
  const NON_VENDOR_HOSTS = [
    'reddit.com',
    'youtube.com',
    'youtu.be',
    'twitter.com',
    'x.com',
    'facebook.com',
    'linkedin.com',
    'medium.com',
    'g2.com',
    'capterra.com',
    'producthunt.com',
    'trustpilot.com',
    'getapp.com',
    'softwareadvice.com',
    'quora.com',
    'wikipedia.org',
    'github.com',
    'stackoverflow.com',
  ];

  const isNonVendor = (h: string) =>
    NON_VENDOR_HOSTS.some((bad) => h === bad || h.endsWith(`.${bad}`));

  for (const r of results) {
    if (!r.link) continue;
    let hostname: string;
    try {
      hostname = new URL(r.link).hostname.replace(/\/$/, '');
    } catch {
      continue;
    }
    if (hostname.endsWith('example.com')) continue;
    if (isNonVendor(hostname)) continue;
    cacheSet(cacheKey, hostname, TTL.LONG);
    return hostname;
  }

  // No usable vendor host found across top 5 organic results.
  cacheSet(cacheKey, null, TTL.LONG);
  return null;
}
