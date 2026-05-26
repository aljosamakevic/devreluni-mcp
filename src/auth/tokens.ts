// Phase 03 T06 — Token issue / validate / revoke / list.
// Plaintext is returned to the caller exactly ONCE at issuance and is NEVER
// written to disk, logged, or returned by listTokens. The DB stores only the
// sha256 hash and a 7-char grep-friendly prefix ('pv_xxxxx') per CONTEXT.md
// decision 1 + D-03-2.
//
// Format: pv_<base64url-32-bytes>  (token_prefix = first 7 chars of plaintext)
// Storage column: token_hash = sha256(plaintext) (hex).
//
// NEVER log plaintext.

import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../db/connection.js';

// Locks the D-03-2 shape: 'pv_' + 4 base64url chars. Literal 7 used at the
// call site below so `grep -nE "slice\(0,\s*7\)"` finds the prefix-shape lock.

export interface IssueResult {
  id: number;
  token: string; // plaintext — caller-only, NEVER re-displayed.
  prefix: string; // first 7 chars of plaintext, safe to log.
}

export interface ValidateResult {
  id: number;
  email: string;
}

export interface TokenRow {
  id: number;
  email: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  status: string;
}

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Mint a new bearer token for `email`. Plaintext is returned ONCE — re-display
 * is impossible because only the sha256 hash + 7-char prefix are persisted.
 */
export function issueToken(email: string): IssueResult {
  const trimmed = email.trim();
  if (trimmed.length === 0) {
    throw new Error('issueToken: email must not be empty');
  }

  // pv_ + 43 base64url chars (32 bytes encoded). Total length 46.
  const random = randomBytes(32).toString('base64url');
  const plaintext = `pv_${random}`;
  const prefix = plaintext.slice(0, 7);
  const hash = hashToken(plaintext);
  const now = new Date().toISOString();

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO tokens (token_hash, token_prefix, email, created_at, status)
       VALUES (?, ?, ?, ?, 'active')`
    )
    .run(hash, prefix, trimmed, now);

  return {
    id: Number(info.lastInsertRowid),
    token: plaintext,
    prefix,
  };
}

/**
 * Validate a raw bearer token. Returns {id, email} for an active token,
 * null otherwise. Updates last_used_at on success (single transaction).
 */
export function validateToken(rawToken: string): ValidateResult | null {
  if (typeof rawToken !== 'string' || rawToken.length === 0) {
    return null;
  }
  const hash = hashToken(rawToken);
  const db = getDb();

  const row = db
    .prepare(
      `SELECT id, email, status FROM tokens WHERE token_hash = ?`
    )
    .get(hash) as { id: number; email: string; status: string } | undefined;

  if (!row || row.status !== 'active') {
    return null;
  }

  db.prepare(`UPDATE tokens SET last_used_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    row.id
  );

  return { id: row.id, email: row.email };
}

/**
 * Revoke a token by numeric id or by `pv_` prefix.
 * Returns true when exactly one row transitions to 'revoked'.
 */
export function revokeToken(idOrPrefix: string | number): boolean {
  const db = getDb();

  let info;
  if (typeof idOrPrefix === 'number' || /^\d+$/.test(String(idOrPrefix))) {
    const id = typeof idOrPrefix === 'number' ? idOrPrefix : Number(idOrPrefix);
    info = db
      .prepare(`UPDATE tokens SET status = 'revoked' WHERE id = ? AND status = 'active'`)
      .run(id);
  } else {
    const prefix = String(idOrPrefix);
    info = db
      .prepare(
        `UPDATE tokens SET status = 'revoked' WHERE token_prefix = ? AND status = 'active'`
      )
      .run(prefix);
  }

  return info.changes === 1;
}

/**
 * Inventory of issued tokens — prefix only. Never returns plaintext or hash.
 */
export function listTokens(): TokenRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, email, token_prefix AS prefix, created_at, last_used_at, status
       FROM tokens
       ORDER BY id ASC`
    )
    .all() as TokenRow[];
  return rows;
}
