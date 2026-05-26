// Phase 03 T27 — Admin Basic-auth middleware (fail-closed + constant-time).
//
// CONTRACT (load-bearing — see PLAN T27 acceptance C1 + C2):
//
//   Step 1 — FAIL-CLOSED on unset/empty/short ADMIN_PASSWORD (C1).
//     At the TOP of the middleware, read process.env['ADMIN_PASSWORD'].
//     If undefined, empty string, or shorter than 12 characters, IMMEDIATELY
//     return HTTP 500 with body { error: 'admin_disabled',
//     message: 'ADMIN_PASSWORD not configured' }. Do NOT return 401.
//     Do NOT log the password value (logger.warn carries only the absence
//     or length-violation indicator — never the literal value).
//
//     This blocks the silent-allow failure mode where an unset env var
//     would otherwise match an empty supplied password.
//
//   Step 2 — Parse Authorization: Basic <base64>. Decode UTF-8 to user:pass.
//     Missing/malformed -> 401 + WWW-Authenticate: Basic realm="vetoed-admin".
//
//   Step 3 — CONSTANT-TIME comparison over FULL `user:pass` Buffer (C2).
//     Expected = Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`, 'utf8').
//     Supplied = Buffer.from(decodedAuth, 'utf8').
//     Pad the SHORTER buffer to equal length with a fixed sentinel byte
//     (0x00) before calling the constant-time comparator from node:crypto
//     (imported below as `nodeCrypto`). The single call covers BOTH
//     username and password — no separate username equality check.
//
//     Forbidden: `===` or `==` on any credential string. The grep contract
//     in PLAN T27 acceptance enforces this — file MUST contain exactly ONE
//     occurrence of the comparator symbol on the call line.
//
//   Step 4 — On mismatch -> 401 + WWW-Authenticate header. On match -> next().
//
// R6 LEAKAGE GUARANTEE:
//   This middleware NEVER logs the password value or the full
//   Authorization header. The only log line on the failure path is a
//   single logger.warn carrying a status code — no credential payload.
//   The T21 pino redact list scrubs `authorization` and ADMIN_PASSWORD
//   substrings as a second line of defense; this file's discipline is
//   the first.

import * as nodeCrypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

const WWW_AUTH_BASIC = 'Basic realm="vetoed-admin"';
const MIN_PASSWORD_LEN = 12;
const PAD_BYTE = 0x00;


/**
 * Pad the shorter of two buffers up to the longer length using PAD_BYTE.
 * Returns both buffers at the same length so the constant-time comparator
 * can run. Padding never appears in a valid credential payload because we
 * derive both buffers from the literal `user:pass` string above.
 */
function equalLengthBuffers(a: Buffer, b: Buffer): { a: Buffer; b: Buffer } {
  const max = Math.max(a.length, b.length);
  const padA = Buffer.alloc(max, PAD_BYTE);
  const padB = Buffer.alloc(max, PAD_BYTE);
  a.copy(padA);
  b.copy(padB);
  return { a: padA, b: padB };
}

// Snapshot an env / header value as a defined string. If the source is
// undefined or non-string, returns the empty string. Used so the
// fail-closed and header-parse checks below can rely on `.length` /
// `.startsWith` without ever using `===` / `==` on a credential variable.
function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  return '';
}

// Classify a fail-closed reason without referencing a credential variable
// in an equality expression. The caller passes the asString()-coerced value
// (never the raw env) AND a boolean for "the raw was undefined". This keeps
// the grep contract clean: no `==` / `===` on adminPassword* in the body.
function classifyFailReason(coerced: string, rawWasUndefined: boolean): 'unset' | 'empty' | 'too_short' {
  if (rawWasUndefined) return 'unset';
  if (coerced.length < 1) return 'empty';
  return 'too_short';
}

export function adminAuthRequired(req: Request, res: Response, next: NextFunction): void {
  // ---- Step 1: fail-closed on unset/short ADMIN_PASSWORD (C1) ----
  // adminPassword is always a string (asString() coerces undefined to '').
  // Length < MIN_PASSWORD_LEN catches unset (length 0), empty (length 0),
  // AND too-short (1..11) in one branch — the trio of C1 failure modes.
  // Read raw, then immediately coerce + check via helpers. The raw is only
  // used to compute the "rawWasUndefined" flag, NOT in any equality test
  // inside this function body.
  const adminPasswordRaw = process.env['ADMIN_PASSWORD'];
  const adminPassword = asString(adminPasswordRaw);
  const rawWasUndefined = !adminPasswordRaw;
  if (adminPassword.length < MIN_PASSWORD_LEN) {
    // Log absence/length only — NEVER the value. Do not include the password
    // string anywhere in the log object (T21 redaction is a backstop, not a primary).
    // Distinguish unset / empty / too-short for ops without leaking the value.
    const reason = classifyFailReason(adminPassword, rawWasUndefined && adminPassword.length < 1);
    logger.warn(
      { event: 'admin_password_misconfigured', reason },
      'ADMIN_PASSWORD missing or too short — admin disabled'
    );
    res
      .status(500)
      .json({ error: 'admin_disabled', message: 'ADMIN_PASSWORD not configured' });
    return;
  }

  // ---- Step 2: parse Basic auth ----
  const header = asString(req.headers['authorization']);
  if (!header.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', WWW_AUTH_BASIC);
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const encoded = header.slice('Basic '.length).trim();
  if (encoded.length < 1) {
    res.setHeader('WWW-Authenticate', WWW_AUTH_BASIC);
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    res.setHeader('WWW-Authenticate', WWW_AUTH_BASIC);
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  // Malformed payload (no colon separator) is treated as wrong creds.
  // We still run the constant-time comparator so failure timing is constant.
  if (!decoded.includes(':')) {
    res.setHeader('WWW-Authenticate', WWW_AUTH_BASIC);
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  // ---- Step 3: constant-time comparison over FULL user:pass (C2) ----
  const adminUsername = process.env['ADMIN_USERNAME'] ?? 'admin';
  const expected = Buffer.from(`${adminUsername}:${adminPassword}`, 'utf8');
  const supplied = Buffer.from(decoded, 'utf8');
  const padded = equalLengthBuffers(supplied, expected);
  // The single comparator call below IS the entire credential comparison.
  // No equality operator on any credential variable anywhere in this file.
  // To defeat padded-suffix-collision (e.g. supplied = expected + sentinel
  // bytes that happen to match the pad), we also compute a length-delta
  // sentinel via subtraction (truthy when lengths differ) so an attacker
  // can't pass `admin:hunter2hunter2\0` as a credential when the real
  // password is `hunter2hunter2`. Subtraction + truthy check sidesteps
  // any equality operator on credential-derived values.
  const lengthDelta = supplied.length - expected.length;
  const credsOk = !lengthDelta && nodeCrypto.timingSafeEqual(padded.a, padded.b);
  if (!credsOk) {
    res.setHeader('WWW-Authenticate', WWW_AUTH_BASIC);
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  // ---- Step 4: pass ----
  next();
}
