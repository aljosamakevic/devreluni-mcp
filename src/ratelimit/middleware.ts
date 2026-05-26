// Phase 03 T13 — Express rateLimit middleware (per-token 429 + Retry-After).
//
// Order of checks (per PLAN T13):
//   1. checkPerTokenLimit(req.tokenId) — if !allowed, respond 429 +
//      Retry-After: <sec> + JSON body { error, reason, retry_after_sec }.
//      ALSO insert a usage_log row with status='rate_limited' BEFORE the
//      response is sent so T11's sliding-window math stays consistent
//      (its WHERE filter excludes status='rate_limited' rows).
//   2. Global Serper cap is NOT pre-checked here — that cap lives inside
//      src/lib/serper.ts and degrades gracefully (NO 429) per CONTEXT.md
//      decision 2 + C7. 429 here is exclusively the per-token cap.
//
// Pure middleware: does NOT consume req.body. authRequired must run first
// (it sets req.tokenId / req.tokenEmail).

import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/connection.js';
import { checkPerTokenLimit } from './per-token.js';
import '../auth/types.js'; // declaration merge for req.tokenId.

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const tokenId = req.tokenId;
  if (typeof tokenId !== 'number') {
    // authRequired should have populated tokenId. If we got here without it,
    // surface a 500 — never silently bypass the limiter (spec §11 anti-pattern 2).
    res.status(500).json({ error: 'server_error', reason: 'rate_limit_missing_token_id' });
    return;
  }

  const check = checkPerTokenLimit(tokenId);
  if (!check.allowed) {
    // Record the rate-limit denial BEFORE responding so concurrent next-window
    // math is consistent. T11's SQL excludes status='rate_limited' rows, so
    // this row does NOT count toward the next check — it just provides an
    // auditable trail of the denial.
    try {
      const tokenName = extractToolName(req) ?? 'rate_limited';
      getDb()
        .prepare(
          `INSERT INTO usage_log (token_id, tool_name, duration_ms, status, created_at)
           VALUES (?, ?, 0, 'rate_limited', ?)`
        )
        .run(tokenId, tokenName, new Date().toISOString());
    } catch (err) {
      // Logging-only — even if the audit insert fails, the 429 still goes out.
      console.error('[rate-limit] failed to record rate_limited row:', err);
    }

    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'rate_limit_per_token_exceeded',
        token_id: tokenId,
        retry_after_sec: check.retryAfterSec,
      })
    );

    res.setHeader('Retry-After', String(check.retryAfterSec));
    res.status(429).json({
      error: 'rate_limited',
      reason: 'per_token_limit_exceeded',
      retry_after_sec: check.retryAfterSec,
    });
    return;
  }

  next();
}

// Best-effort: pull tool name out of a tools/call JSON-RPC body so the
// audit row is useful. Non-tools/call requests get the generic
// 'rate_limited' label.
function extractToolName(req: Request): string | null {
  const body = req.body as
    | { method?: unknown; params?: { name?: unknown } }
    | undefined;
  if (
    body &&
    body.method === 'tools/call' &&
    body.params &&
    typeof body.params.name === 'string'
  ) {
    return body.params.name;
  }
  return null;
}
