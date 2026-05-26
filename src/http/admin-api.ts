// Phase 03 T28 — Admin API endpoints (HTTP).
//
// Routes (all gated by T27's adminAuthRequired via `app.use('/admin', ...)`):
//
//   GET    /admin/api/tokens         -> listTokens() as JSON
//   POST   /admin/api/tokens         -> { email } -> { id, token, prefix }
//                                       Plaintext token included exactly once.
//                                       400 if email missing/empty/malformed.
//   DELETE /admin/api/tokens/:id     -> revokeToken(id) -> { revoked: true }
//                                       404 if no row updated.
//   GET    /admin/api/usage          -> last 100 usage_log rows joined to
//                                       tokens.email, ordered by created_at DESC.
//                                       Shape: { token_id, email, tool_name,
//                                       status, duration_ms, created_at }[]
//
// Gating: registerAdminApi is called AFTER `app.use('/admin', adminAuthRequired)`
// in src/http/server.ts, so every route below inherits the fail-closed +
// Basic-auth gate without re-declaring it here.

import type { Express, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { listTokens, issueToken, revokeToken } from '../auth/tokens.js';
import { logger } from '../lib/logger.js';

// RFC-5322-lite: anything@anything.anything with no whitespace.
// Keep loose — real email validation is the user's problem; we just
// catch obviously broken input.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UsageRow {
  token_id: number;
  email: string;
  tool_name: string;
  status: string;
  duration_ms: number;
  created_at: string;
}

export function registerAdminApi(app: Express, db: Database.Database): void {
  // --- GET /admin/api/tokens ---
  app.get('/admin/api/tokens', (_req: Request, res: Response) => {
    try {
      const rows = listTokens();
      res.status(200).json(rows);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'admin_api_list_tokens_error'
      );
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // --- POST /admin/api/tokens ---
  app.post('/admin/api/tokens', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { email?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (email.length < 1) {
      res.status(400).json({ error: 'bad_request', reason: 'email_required' });
      return;
    }
    if (!EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: 'bad_request', reason: 'email_malformed' });
      return;
    }
    try {
      const issued = issueToken(email);
      // Plaintext returned ONCE — caller (admin UI) displays it in a
      // one-time modal then forgets it. Never logged here.
      res.status(201).json({ id: issued.id, token: issued.token, prefix: issued.prefix });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'admin_api_issue_token_error'
      );
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // --- DELETE /admin/api/tokens/:id ---
  app.delete('/admin/api/tokens/:id', (req: Request, res: Response) => {
    const idParam = req.params['id'];
    if (typeof idParam !== 'string' || !/^\d+$/.test(idParam)) {
      res.status(400).json({ error: 'bad_request', reason: 'id_must_be_integer' });
      return;
    }
    const id = Number(idParam);
    try {
      const ok = revokeToken(id);
      if (!ok) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.status(200).json({ revoked: true });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'admin_api_revoke_token_error'
      );
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // --- GET /admin/api/usage ---
  // Last 100 usage_log rows joined to tokens.email. Ordered DESC by
  // created_at so the UI's "most-recent first" rendering is trivial.
  app.get('/admin/api/usage', (_req: Request, res: Response) => {
    try {
      const rows = db
        .prepare(
          `SELECT
             u.token_id   AS token_id,
             t.email      AS email,
             u.tool_name  AS tool_name,
             u.status     AS status,
             u.duration_ms AS duration_ms,
             u.created_at AS created_at
           FROM usage_log u
           LEFT JOIN tokens t ON t.id = u.token_id
           ORDER BY u.created_at DESC
           LIMIT 100`
        )
        .all() as UsageRow[];
      res.status(200).json(rows);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'admin_api_usage_error'
      );
      res.status(500).json({ error: 'internal_error' });
    }
  });
}
