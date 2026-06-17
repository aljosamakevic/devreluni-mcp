// Phase 05a D-03-5 — Magic link auth CRUD.
//
// One row in magic_link_tokens per /auth/magic-link/request POST. The
// /auth/magic-link/verify GET handler hashes the URL token, peeks the row
// to check validity, mints a bearer via issueToken(), then markMagicLinkUsed
// to bind the bearer back and enforce one-time-use.
//
// Plaintext token shape: 32 random bytes encoded base64url (43 chars). It
// is returned from issueMagicLink ONCE — the caller embeds it in the URL it
// emails; only the sha256(plaintext) hex hash is ever persisted.
//
// Lifecycle:
//   - issueMagicLink   → INSERT row, return plaintext + id + expiresAt
//   - peekMagicLink    → SELECT by hash, return { email, status } WITHOUT
//                        mutating. Status is 'ok' | 'expired' | 'used'.
//   - markMagicLinkUsed → UPDATE set used_at + consumed_token_id. Returns
//                        true on success, false on idempotent re-call or
//                        when the row no longer qualifies.
//   - cleanupExpiredMagicLinks → DELETE rows older than 1d past expiry.
//
// The peek/mark split exists because the verify handler needs the email
// BEFORE it can mint the bearer (issueToken takes email), and it needs
// the bearer ID BEFORE it marks the magic link used (so consumed_token_id
// can be set in the same UPDATE). A single consume() would force a
// chicken-and-egg.
//
// Race window: between peek and markMagicLinkUsed a concurrent click on
// the same link could theoretically both pass peek. markMagicLinkUsed
// guards by re-checking used_at IS NULL inside the UPDATE WHERE clause,
// so only one UPDATE wins. The loser gets `false` back; the caller has
// already minted a (now-orphaned) bearer for the same email — accepted
// per the design lock (multi-device tokens, no revocation on race).

import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../db/connection.js';

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export interface IssueMagicLinkResult {
  plaintext: string; // caller embeds in URL — NEVER re-displayed.
  id: number;
  expiresAt: string; // ISO UTC
}

export type PeekMagicLinkStatus = 'ok' | 'expired' | 'used';

export interface PeekMagicLinkResult {
  email: string;
  status: PeekMagicLinkStatus;
}

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Mint a fresh magic-link token for `email`. Returns the plaintext ONCE so
 * the caller can construct the verify URL and email it. Only the sha256
 * hash + email + timestamps are stored.
 */
export function issueMagicLink(email: string): IssueMagicLinkResult {
  const trimmed = email.trim();
  if (trimmed.length === 0) {
    throw new Error('issueMagicLink: email must not be empty');
  }
  const normalized = normalizeEmail(trimmed);
  const plaintext = randomBytes(32).toString('base64url');
  const hash = hashToken(plaintext);

  const nowMs = Date.now();
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + MAGIC_LINK_TTL_MS).toISOString();

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO magic_link_tokens
         (email, email_normalized, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(trimmed, normalized, hash, createdAt, expiresAt);

  return {
    plaintext,
    id: Number(info.lastInsertRowid),
    expiresAt,
  };
}

/**
 * Read-only lookup. Returns { email, status } without mutating any row.
 * Status:
 *   - 'ok'      → row exists, not used, not expired.
 *   - 'used'    → row exists, already consumed (used_at set).
 *   - 'expired' → row exists, not used, but expires_at < now.
 * Returns null when no row matches the hash.
 */
export function peekMagicLink(plaintext: string): PeekMagicLinkResult | null {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    return null;
  }
  const hash = hashToken(plaintext);
  const db = getDb();

  const row = db
    .prepare(
      `SELECT email, expires_at, used_at
         FROM magic_link_tokens
        WHERE token_hash = ?`
    )
    .get(hash) as
    | { email: string; expires_at: string; used_at: string | null }
    | undefined;

  if (!row) {
    return null;
  }

  if (row.used_at !== null) {
    return { email: row.email, status: 'used' };
  }

  const expiresMs = Date.parse(row.expires_at);
  if (Number.isNaN(expiresMs) || expiresMs < Date.now()) {
    return { email: row.email, status: 'expired' };
  }

  return { email: row.email, status: 'ok' };
}

/**
 * Idempotently mark a magic link as consumed. Returns true when this call
 * flipped used_at; false when the row was already consumed, expired,
 * or doesn't exist. The UPDATE re-checks used_at IS NULL inside its WHERE
 * clause so concurrent clicks can't both succeed.
 *
 * Pass the freshly-issued bearer token id so it can be recorded for audit.
 */
export function markMagicLinkUsed(
  plaintext: string,
  bearerTokenId: number
): boolean {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    return false;
  }
  const hash = hashToken(plaintext);
  const now = new Date().toISOString();
  const db = getDb();

  const info = db
    .prepare(
      `UPDATE magic_link_tokens
          SET used_at = ?, consumed_token_id = ?
        WHERE token_hash = ?
          AND used_at IS NULL`
    )
    .run(now, bearerTokenId, hash);

  return info.changes === 1;
}

/**
 * Phase 13 (audit S-M1) — atomically CLAIM a magic link before any bearer
 * token is minted. Sets used_at IF still null and not expired, in a single
 * UPDATE; returns true only for the one caller that wins. The verify handler
 * mints a bearer ONLY when this returns true, so two concurrent clicks (link
 * prefetchers, double-clicks) can no longer each mint a valid token.
 * consumed_token_id is recorded afterwards via recordConsumedToken().
 */
export function claimMagicLink(plaintext: string): boolean {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    return false;
  }
  const hash = hashToken(plaintext);
  const now = new Date().toISOString();
  const db = getDb();
  const info = db
    .prepare(
      `UPDATE magic_link_tokens
          SET used_at = ?
        WHERE token_hash = ?
          AND used_at IS NULL
          AND expires_at > ?`
    )
    .run(now, hash, now);
  return info.changes === 1;
}

/**
 * Phase 13 — bind the freshly-minted bearer token id to an already-claimed
 * magic link, for audit. Separate from claimMagicLink so the claim can happen
 * before the bearer exists.
 */
export function recordConsumedToken(plaintext: string, bearerTokenId: number): void {
  if (typeof plaintext !== 'string' || plaintext.length === 0) return;
  const hash = hashToken(plaintext);
  const db = getDb();
  db.prepare(
    `UPDATE magic_link_tokens SET consumed_token_id = ? WHERE token_hash = ?`
  ).run(bearerTokenId, hash);
}

/**
 * Best-effort housekeeping. DELETE rows whose expires_at is more than 1 day
 * in the past AND (used_at is null OR used_at is more than 1 day in the
 * past). Returns the number of rows removed.
 *
 * Not load-bearing for v1; exposed for a potential cron later (the table
 * grows ~one row per request, which is fine for thousands of users).
 */
export function cleanupExpiredMagicLinks(): number {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const db = getDb();
  const info = db
    .prepare(
      `DELETE FROM magic_link_tokens
        WHERE expires_at < ?
          AND (used_at IS NULL OR used_at < ?)`
    )
    .run(cutoff, cutoff);
  return info.changes;
}
