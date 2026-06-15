// Phase 03 T12 — Global Serper rate limiter (1,500 calls / UTC day).
//
// Storage: rate_limits table, key = 'global:serper:YYYY-MM-DD' (UTC date).
// Read+write of recordSerperCall happens inside a single SQLite transaction
// (BEGIN..COMMIT) so the counter increments atomically. WAL mode is enabled
// in src/db/connection.ts to support concurrent readers alongside the write.
//
// Race window (PLAN R5 — acceptable):
//   Two concurrent calls can both pass checkGlobalSerperLimit() while count
//   is still 1499 before either increments. The cap therefore admits a small
//   number of "extra" calls per day in the worst case (~1-2 per day under
//   real concurrency). This is documented in CONTEXT.md R5 as acceptable —
//   the alternative (a global lock per call) is not worth the latency cost
//   for a budget that is itself a soft safety net.
//
// Honest-gap contract (C7 final disposition):
//   When the cap fires, src/lib/serper.ts returns stub data and pushes
//   'serper_global_cap' to fallbacks_used. NO 429 is emitted for the global
//   cap — that is reserved exclusively for the per-token cap (T11/T13).
//   This preserves spec §11 anti-pattern 2 + §7 graceful degradation.

import { getDb } from '../db/connection.js';
import { logger } from '../lib/logger.js';

export const GLOBAL_SERPER_LIMIT = 1500;

// The global Serper cap is a HOSTED multi-tenant protection: it guards the
// shared 1,500/UTC-day Serper quota across all web users, backed by the
// rate_limits table on the Fly volume at /data. In LOCAL STDIO mode there is
// no /data volume (getDb throws "Cannot open database because the directory
// does not exist") and no shared quota to protect — the user runs their own
// SERPER_API_KEY. In that case the limiter must FAIL OPEN (allow the search,
// skip global accounting) rather than let a hosted-only concern break core
// search. Before this guard, serperSearch() propagated the getDb throw and
// any tool that didn't wrap serperSearch in its own try/catch died with a
// raw "Cannot open database" error — which calling LLMs then rationalized as
// a fabricated infrastructure failure. This is the structural fix for that.
let dbUnavailableLogged = false;
function tryGetDb(): ReturnType<typeof getDb> | null {
  try {
    return getDb();
  } catch (err) {
    if (!dbUnavailableLogged) {
      logger.warn(
        {
          event: 'global_serper_limiter_disabled',
          reason: err instanceof Error ? err.message : String(err),
        },
        'global Serper limiter disabled — DB unavailable (expected in local stdio mode); failing open'
      );
      dbUnavailableLogged = true;
    }
    return null;
  }
}

export interface GlobalSerperCheck {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** Today's UTC date as YYYY-MM-DD (the rate_limits key suffix). */
function todayUtcKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Seconds remaining until the next UTC midnight (00:00:00 UTC tomorrow). */
function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
  );
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

/** UTC midnight of the current day as ISO string (window_start for new rows). */
function utcMidnightStartIso(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  ).toISOString();
}

/**
 * Read-only check: would the NEXT serper call be allowed?
 * Returns allowed=false when today's counter is at or above GLOBAL_SERPER_LIMIT.
 */
export function checkGlobalSerperLimit(): GlobalSerperCheck {
  const db = tryGetDb();
  if (!db) {
    // Fail open — no hosted DB means no shared quota to enforce (local stdio).
    return { allowed: true, remaining: GLOBAL_SERPER_LIMIT, retryAfterSec: 0 };
  }
  const key = `global:serper:${todayUtcKey()}`;
  const row = db
    .prepare(`SELECT count FROM rate_limits WHERE key = ?`)
    .get(key) as { count: number } | undefined;

  const count = row?.count ?? 0;
  const remaining = Math.max(0, GLOBAL_SERPER_LIMIT - count);

  if (count >= GLOBAL_SERPER_LIMIT) {
    return { allowed: false, remaining: 0, retryAfterSec: secondsUntilUtcMidnight() };
  }
  return { allowed: true, remaining, retryAfterSec: 0 };
}

/**
 * Increment today's global Serper counter. Called from src/lib/serper.ts AFTER
 * a successful LIVE invocation (stub calls do not count). Read+write in a
 * single transaction; see R5 race-window note in the file header.
 */
export function recordSerperCall(): void {
  const db = tryGetDb();
  if (!db) return; // No-op when DB unavailable (local stdio) — nothing to count.
  const key = `global:serper:${todayUtcKey()}`;
  const windowStart = utcMidnightStartIso();

  const txn = db.transaction(() => {
    const existing = db
      .prepare(`SELECT count FROM rate_limits WHERE key = ?`)
      .get(key) as { count: number } | undefined;

    if (existing) {
      db.prepare(`UPDATE rate_limits SET count = count + 1 WHERE key = ?`).run(key);
    } else {
      db.prepare(
        `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)`
      ).run(key, windowStart);
    }
  });
  txn();
}
