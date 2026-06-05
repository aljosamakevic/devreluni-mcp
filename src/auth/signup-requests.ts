// Phase 04 D-03-5 — Self-serve signup request CRUD.
//
// One row in signup_requests per /signup POST. The admin dashboard reads
// the pending subset and approves (which mints a token via issueToken() +
// flips status='approved' + records token_id) or denies (silent — no email).
//
// Deduplication contract (Phase 04 design lock):
//   - If a row exists for the same lowercased email with status='pending' OR
//     status='approved', createSignupRequest returns { id: existingRow.id,
//     deduped: true } and does NOT insert a new row. The caller (signup HTTP
//     handler) still returns the same friendly success message so we never
//     leak "this email already requested" to the public surface.
//   - If the only existing row is status='denied', we INSERT a fresh
//     pending row — denial is not permanent, the user gets a second chance.
//
// Plaintext tokens are returned from approveSignupRequest exactly ONCE so
// the email layer can include them in the welcome email. Never logged.

import { createHash } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { issueToken } from './tokens.js';

export interface SignupRequest {
  id: number;
  email: string;
  email_normalized: string;
  referrer: string | null;
  ip_hash: string | null;
  created_at: string;
  status: 'pending' | 'approved' | 'denied';
  status_changed_at: string | null;
  admin_note: string | null;
  token_id: number | null;
}

export interface CreateSignupRequestInput {
  email: string;
  referrer?: string | null;
  ipHash?: string | null;
}

export interface CreateSignupRequestResult {
  id: number;
  deduped: boolean;
}

export interface ApproveResult {
  request: SignupRequest;
  tokenPlaintext: string;
  tokenPrefix: string;
}

export interface DenyResult {
  request: SignupRequest;
}

/** Hash an IP address for storage. Never store the raw IP. */
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

/** Normalize an email for dedup: trim + lowercase. */
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Create a signup request, applying the dedup rule.
 * Returns { id, deduped: true } when a pending/approved row already exists
 * for this email; returns { id, deduped: false } on a fresh INSERT.
 */
export function createSignupRequest(
  input: CreateSignupRequestInput
): CreateSignupRequestResult {
  const normalized = normalizeEmail(input.email);
  if (normalized.length === 0) {
    throw new Error('createSignupRequest: email must not be empty');
  }

  const referrer =
    typeof input.referrer === 'string' && input.referrer.length > 0
      ? input.referrer
      : null;
  const ipHash =
    typeof input.ipHash === 'string' && input.ipHash.length > 0
      ? input.ipHash
      : null;

  const db = getDb();

  // Dedup check: any pending OR approved row for this email already?
  const existing = db
    .prepare(
      `SELECT id, status FROM signup_requests
       WHERE email_normalized = ?
         AND status IN ('pending', 'approved')
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(normalized) as { id: number; status: string } | undefined;

  if (existing) {
    return { id: existing.id, deduped: true };
  }

  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO signup_requests
         (email, email_normalized, referrer, ip_hash, created_at, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    )
    .run(normalized, normalized, referrer, ipHash, now);

  return { id: Number(info.lastInsertRowid), deduped: false };
}

/**
 * List recent signup requests. Default returns the 100 most-recent pending
 * rows ordered DESC. `status` filter accepts 'pending' | 'approved' | 'denied'.
 */
export function listSignupRequests(
  opts: { status?: 'pending' | 'approved' | 'denied'; limit?: number } = {}
): SignupRequest[] {
  const status = opts.status ?? 'pending';
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 500));
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, email, email_normalized, referrer, ip_hash, created_at,
              status, status_changed_at, admin_note, token_id
       FROM signup_requests
       WHERE status = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(status, limit) as SignupRequest[];
  return rows;
}

/** Single row by id, or null. */
export function getSignupRequest(id: number): SignupRequest | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, email, email_normalized, referrer, ip_hash, created_at,
              status, status_changed_at, admin_note, token_id
       FROM signup_requests
       WHERE id = ?`
    )
    .get(id) as SignupRequest | undefined;
  return row ?? null;
}

/**
 * Approve a pending request: mint a token, flip status, record admin_note +
 * status_changed_at + token_id. Returns the fresh row plus the plaintext
 * token (caller must include it in the welcome email — it is NOT stored).
 *
 * Returns null when the request does not exist OR is already non-pending
 * (idempotency guard: double-approve returns null, the caller surfaces 404).
 */
export function approveSignupRequest(
  id: number,
  adminNote: string | null
): ApproveResult | null {
  const db = getDb();

  // Look up the current state INSIDE the transaction so a concurrent approve
  // can't race past us.
  const txn = db.transaction((): ApproveResult | null => {
    const current = db
      .prepare(`SELECT email, status FROM signup_requests WHERE id = ?`)
      .get(id) as { email: string; status: string } | undefined;

    if (!current || current.status !== 'pending') {
      return null;
    }

    const issued = issueToken(current.email);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE signup_requests
         SET status = 'approved',
             status_changed_at = ?,
             admin_note = ?,
             token_id = ?
       WHERE id = ?`
    ).run(now, adminNote, issued.id, id);

    const refreshed = db
      .prepare(
        `SELECT id, email, email_normalized, referrer, ip_hash, created_at,
                status, status_changed_at, admin_note, token_id
         FROM signup_requests
         WHERE id = ?`
      )
      .get(id) as SignupRequest;

    return {
      request: refreshed,
      tokenPlaintext: issued.token,
      tokenPrefix: issued.prefix,
    };
  });

  return txn();
}

/**
 * Mark a pending request as denied. No email is sent. Returns null when
 * the request does not exist OR is already non-pending.
 */
export function denySignupRequest(id: number): DenyResult | null {
  const db = getDb();

  const txn = db.transaction((): DenyResult | null => {
    const current = db
      .prepare(`SELECT status FROM signup_requests WHERE id = ?`)
      .get(id) as { status: string } | undefined;

    if (!current || current.status !== 'pending') {
      return null;
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE signup_requests
         SET status = 'denied',
             status_changed_at = ?
       WHERE id = ?`
    ).run(now, id);

    const refreshed = db
      .prepare(
        `SELECT id, email, email_normalized, referrer, ip_hash, created_at,
                status, status_changed_at, admin_note, token_id
         FROM signup_requests
         WHERE id = ?`
      )
      .get(id) as SignupRequest;

    return { request: refreshed };
  });

  return txn();
}
