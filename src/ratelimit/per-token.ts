// Phase 03 T11 — Per-token rate limiter (sliding window via SQLite usage_log).
//
// Per-token rate-limit math:
//   - User-facing budget: 20 validate_idea runs / day / token (CONTEXT.md decision 2)
//   - Spec §11 DoD tool-call budget: ≤20 tool calls per validate_idea (UPPER BOUND)
//   - Worst case per-token tool calls: 20 runs × 20 tool calls = 400 / day
//   - Typical case: 20 runs × ~13 tool calls ≈ 260 / day
// We enforce at the tool-call layer (the MCP server cannot observe a "prompt
// invocation" — prompts are LLM-side orchestration). Threshold = 400 so a user
// who hits the spec UPPER bound on every run still gets ~20 validations/day.
// A typical user hitting the threshold has actually run ~30 validate_ideas
// (400 / 13 ≈ 30), which is well past the 20-run guarantee — they were
// generous-mode users who deserved the cap. Documented in T20 (HOSTED_SETUP.md).
//
// Sliding-window SQL excludes status='rate_limited' rows so 429 denials do not
// inflate the next window's counter (T13 inserts the 'rate_limited' row BEFORE
// returning so the math here remains consistent across concurrent requests).

import { getDb } from '../db/connection.js';

export const PER_TOKEN_LIMIT = 400;
export const WINDOW_SECONDS = 24 * 60 * 60;

export interface PerTokenCheck {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Sliding-window check against usage_log. Returns allowed=true while count
 * within the last 24h is < PER_TOKEN_LIMIT. When at/over the threshold,
 * retryAfterSec is the seconds until the oldest qualifying row falls out
 * of the window (i.e. 24h after its created_at).
 */
export function checkPerTokenLimit(tokenId: number): PerTokenCheck {
  const db = getDb();

  // Count only successful + error rows in the last 24h. Rate-limit denials
  // (status='rate_limited') are excluded so a token already capped doesn't
  // see its window stretched by its own 429s.
  const countRow = db
    .prepare(
      `SELECT count(*) AS c
       FROM usage_log
       WHERE token_id = ?
         AND created_at > datetime('now', '-1 day')
         AND status != 'rate_limited'`
    )
    .get(tokenId) as { c: number };

  const count = countRow.c;
  const remaining = Math.max(0, PER_TOKEN_LIMIT - count);

  if (count < PER_TOKEN_LIMIT) {
    return { allowed: true, remaining, retryAfterSec: 0 };
  }

  // Over the threshold. Find the oldest qualifying row and compute seconds
  // until it ages out (24h after its created_at).
  const oldestRow = db
    .prepare(
      `SELECT MIN(created_at) AS oldest
       FROM usage_log
       WHERE token_id = ?
         AND created_at > datetime('now', '-1 day')
         AND status != 'rate_limited'`
    )
    .get(tokenId) as { oldest: string | null };

  let retryAfterSec = WINDOW_SECONDS;
  if (oldestRow.oldest) {
    const oldestMs = Date.parse(oldestRow.oldest);
    if (!Number.isNaN(oldestMs)) {
      const ageOutMs = oldestMs + WINDOW_SECONDS * 1000;
      const diffSec = Math.ceil((ageOutMs - Date.now()) / 1000);
      retryAfterSec = Math.max(1, diffSec);
    }
  }

  return { allowed: false, remaining: 0, retryAfterSec };
}
