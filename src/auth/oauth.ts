// Phase 14 — OAuth 2.1 Authorization Server storage + helpers.
//
// veto is its own AS + Resource Server. OAuth-issued access tokens are minted
// into the existing `tokens` table (same pv_ shape) by the token endpoint, so
// authRequired validates them unchanged. This module owns only the
// OAuth-specific state: registered clients (DCR), single-use authorization
// codes (PKCE S256), and refresh tokens. Plaintext codes/tokens are never
// stored — only sha256 hashes.

import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../db/connection.js';

export const ACCESS_TOKEN_SCOPE = 'mcp';
const AUTH_CODE_TTL_MS = 60_000; // 60s, single-use (OAuth 2.1)

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Dynamic Client Registration (RFC 7591) ────────────────────────────────

export interface OAuthClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
}

/** Register a public client. redirect_uris must be a non-empty array of
 *  absolute https URIs (or http://localhost for dev tooling). */
export function registerClient(input: {
  client_name?: string;
  redirect_uris: string[];
}): OAuthClient {
  const uris = (input.redirect_uris ?? []).filter((u) => typeof u === 'string' && u.length > 0);
  if (uris.length === 0) {
    throw new Error('redirect_uris must contain at least one URI');
  }
  for (const u of uris) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      throw new Error(`invalid redirect_uri: ${u}`);
    }
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalhost)) {
      throw new Error(`redirect_uri must be https (or http://localhost): ${u}`);
    }
  }
  const client_id = `vc_${base64url(randomBytes(24))}`;
  const client_name = input.client_name?.slice(0, 200) ?? null;
  getDb()
    .prepare(`INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)`)
    .run(client_id, client_name, JSON.stringify(uris), new Date().toISOString());
  return { client_id, client_name, redirect_uris: uris };
}

export function getClient(clientId: string): OAuthClient | null {
  const row = getDb()
    .prepare(`SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?`)
    .get(clientId) as { client_id: string; client_name: string | null; redirect_uris: string } | undefined;
  if (!row) return null;
  let uris: string[] = [];
  try {
    uris = JSON.parse(row.redirect_uris) as string[];
  } catch {
    uris = [];
  }
  return { client_id: row.client_id, client_name: row.client_name, redirect_uris: uris };
}

/** Exact-match redirect_uri validation (OAuth 2.1 — no wildcards/prefixes). */
export function isRegisteredRedirectUri(clientId: string, redirectUri: string): boolean {
  const c = getClient(clientId);
  return !!c && c.redirect_uris.includes(redirectUri);
}

// ── Authorization codes (single-use, PKCE S256) ───────────────────────────

/** Mint a single-use authorization code bound to client + redirect_uri +
 *  PKCE challenge + the authenticated user. Returns the plaintext code. */
export function createAuthCode(input: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  email: string;
  scope?: string;
}): string {
  const code = `vac_${base64url(randomBytes(32))}`;
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, email, scope, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      sha256(code),
      input.clientId,
      input.redirectUri,
      input.codeChallenge,
      input.email,
      input.scope ?? ACCESS_TOKEN_SCOPE,
      new Date(now).toISOString(),
      new Date(now + AUTH_CODE_TTL_MS).toISOString()
    );
  return code;
}

export type ConsumeCodeResult =
  | { ok: true; email: string; scope: string }
  | { ok: false; error: 'invalid_grant'; reason: string };

/**
 * Atomically consume an authorization code: verify it exists, is unconsumed,
 * unexpired, bound to this client + redirect_uri, and that the PKCE verifier
 * matches the stored S256 challenge. Single-use is enforced by an atomic
 * UPDATE … WHERE consumed_at IS NULL.
 */
export function consumeAuthCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): ConsumeCodeResult {
  const db = getDb();
  const hash = sha256(input.code);
  const row = db
    .prepare(
      `SELECT client_id, redirect_uri, code_challenge, email, scope, expires_at, consumed_at
         FROM oauth_codes WHERE code_hash = ?`
    )
    .get(hash) as
    | {
        client_id: string;
        redirect_uri: string;
        code_challenge: string;
        email: string;
        scope: string | null;
        expires_at: string;
        consumed_at: string | null;
      }
    | undefined;

  if (!row) return { ok: false, error: 'invalid_grant', reason: 'unknown code' };
  if (row.consumed_at !== null) return { ok: false, error: 'invalid_grant', reason: 'code already used' };
  if (row.client_id !== input.clientId) return { ok: false, error: 'invalid_grant', reason: 'client mismatch' };
  if (row.redirect_uri !== input.redirectUri) return { ok: false, error: 'invalid_grant', reason: 'redirect_uri mismatch' };
  if (Date.parse(row.expires_at) < Date.now()) return { ok: false, error: 'invalid_grant', reason: 'code expired' };

  // PKCE S256: challenge === base64url(sha256(verifier))
  const expectedChallenge = base64url(createHash('sha256').update(input.codeVerifier).digest());
  if (expectedChallenge !== row.code_challenge) {
    return { ok: false, error: 'invalid_grant', reason: 'PKCE verification failed' };
  }

  // Atomic single-use claim.
  const claimed = db
    .prepare(`UPDATE oauth_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL`)
    .run(new Date().toISOString(), hash);
  if (claimed.changes !== 1) return { ok: false, error: 'invalid_grant', reason: 'code already used (race)' };

  return { ok: true, email: row.email, scope: row.scope ?? ACCESS_TOKEN_SCOPE };
}

// ── Refresh tokens ─────────────────────────────────────────────────────────

export function createRefreshToken(clientId: string, email: string): string {
  const token = `vrt_${base64url(randomBytes(32))}`;
  getDb()
    .prepare(`INSERT INTO oauth_refresh_tokens (token_hash, client_id, email, created_at) VALUES (?, ?, ?, ?)`)
    .run(sha256(token), clientId, email, new Date().toISOString());
  return token;
}

export type RefreshResult =
  | { ok: true; email: string }
  | { ok: false; error: 'invalid_grant'; reason: string };

/** Validate + rotate a refresh token (single-use rotation): the presented
 *  token is revoked and the caller mints a new one. */
export function rotateRefreshToken(token: string, clientId: string): RefreshResult {
  const db = getDb();
  const hash = sha256(token);
  const row = db
    .prepare(`SELECT client_id, email, revoked_at FROM oauth_refresh_tokens WHERE token_hash = ?`)
    .get(hash) as { client_id: string; email: string; revoked_at: string | null } | undefined;
  if (!row) return { ok: false, error: 'invalid_grant', reason: 'unknown refresh token' };
  if (row.revoked_at !== null) return { ok: false, error: 'invalid_grant', reason: 'refresh token revoked' };
  if (row.client_id !== clientId) return { ok: false, error: 'invalid_grant', reason: 'client mismatch' };
  const revoked = db
    .prepare(`UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`)
    .run(new Date().toISOString(), hash);
  if (revoked.changes !== 1) return { ok: false, error: 'invalid_grant', reason: 'refresh token already rotated' };
  return { ok: true, email: row.email };
}
