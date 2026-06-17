// Phase 14 — Per-USER rate limiter. With OAuth a single human can hold many
// tokens (refresh rotation mints a new access token each time), so a per-token
// cap would let a user multiply their quota. This limiter counts tool calls
// across ALL of a user's tokens (joined by email) in the same 24h sliding
// window as per-token. The per-token limiter remains the fallback for legacy
// static tokens that have no meaningful per-user grouping difference.
//
// Same window semantics as per-token.ts (status='rate_limited' rows excluded).

import { getDb } from '../db/connection.js';
import { WINDOW_SECONDS } from './per-token.js';

export const PER_USER_LIMIT = 400;

export interface PerUserCheck {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function checkPerUserLimit(email: string): PerUserCheck {
  const db = getDb();
  const countRow = db
    .prepare(
      `SELECT count(*) AS c
         FROM usage_log u JOIN tokens t ON u.token_id = t.id
        WHERE t.email = ?
          AND u.created_at > datetime('now', '-1 day')
          AND u.status != 'rate_limited'`
    )
    .get(email) as { c: number };

  const count = countRow.c;
  const remaining = Math.max(0, PER_USER_LIMIT - count);
  if (count < PER_USER_LIMIT) {
    return { allowed: true, remaining, retryAfterSec: 0 };
  }

  const oldestRow = db
    .prepare(
      `SELECT MIN(u.created_at) AS oldest
         FROM usage_log u JOIN tokens t ON u.token_id = t.id
        WHERE t.email = ?
          AND u.created_at > datetime('now', '-1 day')
          AND u.status != 'rate_limited'`
    )
    .get(email) as { oldest: string | null };

  let retryAfterSec = WINDOW_SECONDS;
  if (oldestRow.oldest) {
    const oldestMs = Date.parse(oldestRow.oldest);
    if (!Number.isNaN(oldestMs)) {
      retryAfterSec = Math.max(1, Math.ceil((oldestMs + WINDOW_SECONDS * 1000 - Date.now()) / 1000));
    }
  }
  return { allowed: false, remaining: 0, retryAfterSec };
}
