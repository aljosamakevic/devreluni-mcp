import type { ToolSource } from '../types.js';

/**
 * Wayback Machine CDX client — verified historical snapshots only.
 *
 * Spec §4 lists Wayback snapshots as S-tier/independent. The "available" endpoint
 * returns the closest archived snapshot for a given URL+timestamp, or an empty
 * snapshots object if nothing was ever archived. We refuse to fabricate URLs.
 *
 * Endpoint: http://archive.org/wayback/available?url=<url>&timestamp=YYYYMMDD
 * Response shape:
 *   {
 *     "url": "<requested>",
 *     "archived_snapshots": {
 *       "closest": { "available": true, "url": "https://web.archive.org/web/20240115.../...", "timestamp": "20240115...", "status": "200" }
 *     }
 *   }
 * If no snapshot exists the `archived_snapshots` object is empty `{}`.
 *
 * Spec §11 anti-pattern 2: "Soft-failing tool calls — returning made-up data when
 * the API fails." This module returns `null` on miss/failure rather than a
 * synthesized URL. Callers must decide how to render absence.
 */

export interface WaybackSnapshot {
  url: string; // real web.archive.org/web/<numeric-timestamp>/<original-url>
  timestamp: string; // YYYYMMDDHHMMSS
  original_url: string; // the URL that was looked up
}

const WAYBACK_AVAILABLE = 'http://archive.org/wayback/available';
const FETCH_TIMEOUT_MS = 3000;

interface WaybackAvailableResponse {
  url?: string;
  archived_snapshots?: {
    closest?: {
      available?: boolean;
      url?: string;
      timestamp?: string;
      status?: string;
    };
  };
}

/**
 * Look up the closest archived snapshot for a URL, optionally near a given date.
 * Returns the actual snapshot or `null` — never a fabricated URL.
 *
 * @param url The original URL to look up (e.g. https://forestapp.cc/pricing)
 * @param timestamp Optional anchor date (YYYYMMDD or YYYYMMDDHHMMSS). Defaults to "now".
 */
export async function waybackLookup(
  url: string,
  timestamp?: string
): Promise<WaybackSnapshot | null> {
  try {
    const params = new URLSearchParams({ url });
    if (timestamp) params.set('timestamp', timestamp);
    const endpoint = `${WAYBACK_AVAILABLE}?${params.toString()}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: {
          'User-Agent': 'product-validation-mcp/0.1.0',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      console.error(`[wayback.ts] Wayback returned ${response.status} for ${url}`);
      return null;
    }

    const data = (await response.json()) as WaybackAvailableResponse;
    const closest = data.archived_snapshots?.closest;
    if (!closest || !closest.available || !closest.url || !closest.timestamp) {
      return null;
    }

    return {
      url: closest.url,
      timestamp: closest.timestamp,
      original_url: url,
    };
  } catch (err) {
    console.error('[wayback.ts] waybackLookup error:', err);
    return null;
  }
}

/**
 * Wayback CDX is unauthenticated and always considered "live" (no API key check).
 * The quartet predicate exists for parity with serper/producthunt patterns; callers
 * can use it for symmetry even though it currently returns true unconditionally.
 */
export function isWaybackLive(): boolean {
  return true;
}

/**
 * Build a ToolSource for a *real* Wayback snapshot. Spec §4: Wayback = S/independent.
 * The `fetched_at` is set to the snapshot's archive timestamp (parsed into ISO),
 * not "now" — what we cite is the moment the archive was captured.
 */
export function waybackSource(snapshot: WaybackSnapshot, contributionHint?: string): ToolSource {
  const iso = waybackTimestampToISO(snapshot.timestamp) ?? new Date().toISOString();
  return {
    url: snapshot.url,
    tier: 'S',
    bias: 'independent',
    fetched_at: iso,
    contribution:
      contributionHint ??
      `Wayback Machine snapshot of ${snapshot.original_url} captured ${iso.slice(0, 10)}`,
  };
}

export function waybackConfidenceNote(found: number, attempted: number): string {
  if (attempted === 0) return 'Wayback: no lookups attempted.';
  if (found === 0) {
    return `Wayback: 0/${attempted} URLs had archived snapshots (no historical data available).`;
  }
  if (found === attempted) {
    return `Wayback: ${found}/${attempted} verified historical snapshots cited.`;
  }
  return `Wayback: ${found}/${attempted} URLs had verified snapshots; ${attempted - found} had no archive.`;
}

/**
 * Convert Wayback "YYYYMMDDHHMMSS" (or "YYYYMMDD") timestamp to ISO 8601.
 * Returns null if unparseable.
 */
export function waybackTimestampToISO(ts: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?$/.exec(ts);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
