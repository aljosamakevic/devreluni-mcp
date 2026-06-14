// Phase 05a D-03-5 — Per-IP rate limit for the magic-link request endpoint.
//
// Mirrors src/ratelimit/signup-ip.ts (Phase 04). Same 1h fixed-window math,
// same SQLite rate_limits table, same transactional read+write. Keyed under
// a distinct prefix so a user who already burned their /signup quota can
// still try /auth/magic-link/request (and vice versa).
//
// Storage shape:
//   rate_limits.key          = 'magic:ip:<sha256-hex-of-IP>'
//   rate_limits.count        = magic-link requests within the current 1h window
//   rate_limits.window_start = ISO UTC timestamp when the window opened
//
// Concurrency: read + write happens inside a single SQLite transaction so
// two concurrent calls from the same IP can't both pass with count = 4.
// Race-window discipline inherited from R5 / src/ratelimit/global.ts.

import { getDb } from '../db/connection.js';

export const MAGIC_LINK_IP_LIMIT = 5;
export const MAGIC_LINK_IP_WINDOW_SECONDS = 60 * 60; // 1 hour

export interface MagicLinkIpCheck {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

function keyForIp(ipHash: string): string {
  return `magic:ip:${ipHash}`;
}

/**
 * Atomic check-and-increment for the per-IP magic-link request quota.
 * Pass the SHA256 of the source IP (not the raw IP) — same hashIp() helper
 * the signup endpoint uses.
 */
export function checkAndIncrementMagicLinkIp(ipHash: string): MagicLinkIpCheck {
  const db = getDb();
  const key = keyForIp(ipHash);

  let result: MagicLinkIpCheck = {
    allowed: true,
    remaining: MAGIC_LINK_IP_LIMIT - 1,
    retryAfterSec: 0,
  };

  const txn = db.transaction(() => {
    const row = db
      .prepare(`SELECT count, window_start FROM rate_limits WHERE key = ?`)
      .get(key) as { count: number; window_start: string } | undefined;

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    if (!row) {
      db.prepare(
        `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)`
      ).run(key, nowIso);
      result = {
        allowed: true,
        remaining: MAGIC_LINK_IP_LIMIT - 1,
        retryAfterSec: 0,
      };
      return;
    }

    const windowStartMs = Date.parse(row.window_start);
    const windowAgeMs = nowMs - windowStartMs;
    const windowMs = MAGIC_LINK_IP_WINDOW_SECONDS * 1000;

    if (Number.isNaN(windowStartMs) || windowAgeMs >= windowMs) {
      db.prepare(
        `UPDATE rate_limits SET count = 1, window_start = ? WHERE key = ?`
      ).run(nowIso, key);
      result = {
        allowed: true,
        remaining: MAGIC_LINK_IP_LIMIT - 1,
        retryAfterSec: 0,
      };
      return;
    }

    if (row.count >= MAGIC_LINK_IP_LIMIT) {
      const retrySec = Math.max(
        1,
        Math.ceil((windowStartMs + windowMs - nowMs) / 1000)
      );
      result = { allowed: false, remaining: 0, retryAfterSec: retrySec };
      return;
    }

    db.prepare(`UPDATE rate_limits SET count = count + 1 WHERE key = ?`).run(key);
    const newCount = row.count + 1;
    result = {
      allowed: true,
      remaining: Math.max(0, MAGIC_LINK_IP_LIMIT - newCount),
      retryAfterSec: 0,
    };
  });

  txn();
  return result;
}
