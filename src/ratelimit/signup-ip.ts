// Phase 04 D-03-5 — Per-IP signup rate limit.
//
// Storage shape:
//   rate_limits.key = 'signup:ip:<sha256-hex-of-IP>'
//   rate_limits.count = number of signup attempts within the current 1h window
//   rate_limits.window_start = ISO timestamp UTC of when this window opened
//
// Window math (1h sliding):
//   - When we get a request from an IP:
//       1. Look up the existing row by key.
//       2. If no row → INSERT count=1, window_start = now. allow.
//       3. If row exists AND window_start > 1h ago → INCREMENT count.
//            - If count was already at SIGNUP_IP_LIMIT → deny + retryAfter.
//            - Else → allow.
//       4. If row exists AND window_start ≤ 1h ago → window has expired.
//          RESET count=1, window_start=now. allow.
//
//   This is NOT a perfect sliding-window — it's a fixed 1h window keyed off
//   `window_start`. A user who exhausts their 5 in the first minute of a
//   window will wait ~59 minutes for the reset. That's fine for an anti-spam
//   gate (we want a deterrent, not a smooth ramp). It also matches the
//   global.ts UTC-day pattern (single row per key, transactional read+write,
//   no per-call history table).
//
// Concurrency: read + write happens inside a single SQLite transaction so
// two concurrent calls from the same IP can't both pass with count=4.
// Mirrors src/ratelimit/global.ts R5 race-window discipline.

import { getDb } from '../db/connection.js';

export const SIGNUP_IP_LIMIT = 5;
export const SIGNUP_IP_WINDOW_SECONDS = 60 * 60; // 1 hour

export interface SignupIpCheck {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** Build the storage key for a hashed IP. */
function keyForIp(ipHash: string): string {
  return `signup:ip:${ipHash}`;
}

/**
 * Atomic check-and-increment: if the current 1h window for this IP has room,
 * increment and return allowed: true. Otherwise return allowed: false with
 * the seconds until the window resets.
 *
 * Pass the SHA256 of the source IP (not the raw IP). Mirroring src/auth/
 * signup-requests.ts → hashIp().
 */
export function checkAndIncrementSignupIp(ipHash: string): SignupIpCheck {
  const db = getDb();
  const key = keyForIp(ipHash);

  let result: SignupIpCheck = {
    allowed: true,
    remaining: SIGNUP_IP_LIMIT - 1,
    retryAfterSec: 0,
  };

  const txn = db.transaction(() => {
    const row = db
      .prepare(`SELECT count, window_start FROM rate_limits WHERE key = ?`)
      .get(key) as { count: number; window_start: string } | undefined;

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    if (!row) {
      // First attempt for this IP — open a new window.
      db.prepare(
        `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)`
      ).run(key, nowIso);
      result = { allowed: true, remaining: SIGNUP_IP_LIMIT - 1, retryAfterSec: 0 };
      return;
    }

    const windowStartMs = Date.parse(row.window_start);
    const windowAgeMs = nowMs - windowStartMs;
    const windowMs = SIGNUP_IP_WINDOW_SECONDS * 1000;

    if (Number.isNaN(windowStartMs) || windowAgeMs >= windowMs) {
      // Window expired — reset to count=1 with fresh window_start.
      db.prepare(
        `UPDATE rate_limits SET count = 1, window_start = ? WHERE key = ?`
      ).run(nowIso, key);
      result = { allowed: true, remaining: SIGNUP_IP_LIMIT - 1, retryAfterSec: 0 };
      return;
    }

    // Window active. Are we at/over the cap?
    if (row.count >= SIGNUP_IP_LIMIT) {
      const retrySec = Math.max(
        1,
        Math.ceil((windowStartMs + windowMs - nowMs) / 1000)
      );
      result = { allowed: false, remaining: 0, retryAfterSec: retrySec };
      return;
    }

    // Increment.
    db.prepare(`UPDATE rate_limits SET count = count + 1 WHERE key = ?`).run(key);
    const newCount = row.count + 1;
    result = {
      allowed: true,
      remaining: Math.max(0, SIGNUP_IP_LIMIT - newCount),
      retryAfterSec: 0,
    };
  });

  txn();
  return result;
}
