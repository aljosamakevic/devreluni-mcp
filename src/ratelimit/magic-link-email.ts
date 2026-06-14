// Phase 05a D-03-5 — Per-email rate limit for the magic-link request endpoint.
//
// Backstop for distributed spam where many IPs target the same inbox. The
// per-IP limit catches honest-mistake floods; the per-email limit prevents a
// botnet from filling someone's mailbox with sign-in links.
//
// Same shape as signup-ip / magic-link-ip: 5/hour fixed window, single row
// in the rate_limits table keyed under a distinct prefix so the IP and email
// quotas can't collide.
//
// Storage shape:
//   rate_limits.key          = 'magic:email:<sha256-hex-of-lowercased-email>'
//   rate_limits.count        = magic-link requests within the current 1h window
//   rate_limits.window_start = ISO UTC timestamp when the window opened
//
// Concurrency: read + write happens inside a single SQLite transaction so
// two concurrent calls for the same email can't both pass with count = 4.
// Race-window discipline inherited from R5 / src/ratelimit/global.ts.

import { createHash } from 'node:crypto';
import { getDb } from '../db/connection.js';

export const MAGIC_LINK_EMAIL_LIMIT = 5;
export const MAGIC_LINK_EMAIL_WINDOW_SECONDS = 60 * 60; // 1 hour

export interface MagicLinkEmailCheck {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** Hash a lowercased email for storage. Never store the raw email in the key. */
export function hashEmailForRateLimit(rawEmail: string): string {
  return createHash('sha256').update(rawEmail.trim().toLowerCase()).digest('hex');
}

function keyForEmail(emailHash: string): string {
  return `magic:email:${emailHash}`;
}

/**
 * Atomic check-and-increment for the per-email magic-link request quota.
 * Pass the SHA256 of the lowercased email (use hashEmailForRateLimit()).
 */
export function checkAndIncrementMagicLinkEmail(
  emailHash: string
): MagicLinkEmailCheck {
  const db = getDb();
  const key = keyForEmail(emailHash);

  let result: MagicLinkEmailCheck = {
    allowed: true,
    remaining: MAGIC_LINK_EMAIL_LIMIT - 1,
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
        remaining: MAGIC_LINK_EMAIL_LIMIT - 1,
        retryAfterSec: 0,
      };
      return;
    }

    const windowStartMs = Date.parse(row.window_start);
    const windowAgeMs = nowMs - windowStartMs;
    const windowMs = MAGIC_LINK_EMAIL_WINDOW_SECONDS * 1000;

    if (Number.isNaN(windowStartMs) || windowAgeMs >= windowMs) {
      db.prepare(
        `UPDATE rate_limits SET count = 1, window_start = ? WHERE key = ?`
      ).run(nowIso, key);
      result = {
        allowed: true,
        remaining: MAGIC_LINK_EMAIL_LIMIT - 1,
        retryAfterSec: 0,
      };
      return;
    }

    if (row.count >= MAGIC_LINK_EMAIL_LIMIT) {
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
      remaining: Math.max(0, MAGIC_LINK_EMAIL_LIMIT - newCount),
      retryAfterSec: 0,
    };
  });

  txn();
  return result;
}
