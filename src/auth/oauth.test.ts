/**
 * Phase 14 — OAuth AS core: DCR validation, PKCE S256, single-use auth codes,
 * refresh-token rotation. Pure storage/crypto logic (no HTTP), so fully unit
 * tested here; the endpoint wiring + full handshake get a scripted e2e smoke.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetDbForTests, getDb } from '../db/connection.js';
import {
  registerClient,
  getClient,
  isRegisteredRedirectUri,
  createAuthCode,
  consumeAuthCode,
  createRefreshToken,
  rotateRefreshToken,
} from './oauth.js';

const DB_PATH = join(tmpdir(), `vetoed-test-oauth-${randomBytes(6).toString('hex')}.db`);
const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

beforeAll(() => {
  process.env['VETOED_DB_PATH'] = DB_PATH;
  __resetDbForTests();
  getDb();
});
beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM oauth_codes; DELETE FROM oauth_refresh_tokens; DELETE FROM oauth_clients;');
});
afterAll(() => {
  __resetDbForTests();
  for (const s of ['', '-wal', '-shm']) if (existsSync(`${DB_PATH}${s}`)) try { rmSync(`${DB_PATH}${s}`); } catch { /* best-effort */ }
});

describe('dynamic client registration', () => {
  it('registers a client with https redirect URIs', () => {
    const c = registerClient({ client_name: 'claude.ai', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
    expect(c.client_id).toMatch(/^vc_/);
    expect(getClient(c.client_id)?.redirect_uris).toEqual(['https://claude.ai/api/mcp/auth_callback']);
    expect(isRegisteredRedirectUri(c.client_id, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isRegisteredRedirectUri(c.client_id, 'https://evil.example/cb')).toBe(false);
  });
  it('rejects empty or non-https redirect URIs (localhost http allowed)', () => {
    expect(() => registerClient({ redirect_uris: [] })).toThrow();
    expect(() => registerClient({ redirect_uris: ['http://evil.example/cb'] })).toThrow();
    expect(registerClient({ redirect_uris: ['http://localhost:8080/cb'] }).client_id).toMatch(/^vc_/);
  });
});

describe('authorization code + PKCE', () => {
  function setup() {
    const c = registerClient({ redirect_uris: ['https://claude.ai/cb'] });
    const { verifier, challenge } = pkcePair();
    const code = createAuthCode({ clientId: c.client_id, redirectUri: 'https://claude.ai/cb', codeChallenge: challenge, email: 'u@example.com' });
    return { clientId: c.client_id, verifier, code };
  }

  it('consumes a valid code once with the correct verifier', () => {
    const { clientId, verifier, code } = setup();
    const r = consumeAuthCode({ code, clientId, redirectUri: 'https://claude.ai/cb', codeVerifier: verifier });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.email).toBe('u@example.com');
  });

  it('rejects a second consumption (single-use)', () => {
    const { clientId, verifier, code } = setup();
    expect(consumeAuthCode({ code, clientId, redirectUri: 'https://claude.ai/cb', codeVerifier: verifier }).ok).toBe(true);
    const r2 = consumeAuthCode({ code, clientId, redirectUri: 'https://claude.ai/cb', codeVerifier: verifier });
    expect(r2.ok).toBe(false);
  });

  it('rejects a wrong PKCE verifier', () => {
    const { clientId, code } = setup();
    const r = consumeAuthCode({ code, clientId, redirectUri: 'https://claude.ai/cb', codeVerifier: 'wrong-verifier' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/PKCE/);
  });

  it('rejects a redirect_uri or client mismatch', () => {
    const { clientId, verifier, code } = setup();
    expect(consumeAuthCode({ code, clientId, redirectUri: 'https://claude.ai/OTHER', codeVerifier: verifier }).ok).toBe(false);
    expect(consumeAuthCode({ code, clientId: 'vc_other', redirectUri: 'https://claude.ai/cb', codeVerifier: verifier }).ok).toBe(false);
  });
});

describe('refresh-token rotation', () => {
  it('rotates once, then rejects the rotated token', () => {
    const c = registerClient({ redirect_uris: ['https://claude.ai/cb'] });
    const rt = createRefreshToken(c.client_id, 'u@example.com');
    const r1 = rotateRefreshToken(rt, c.client_id);
    expect(r1.ok).toBe(true);
    const r2 = rotateRefreshToken(rt, c.client_id);
    expect(r2.ok).toBe(false);
  });
  it('rejects a refresh token presented by the wrong client', () => {
    const c = registerClient({ redirect_uris: ['https://claude.ai/cb'] });
    const rt = createRefreshToken(c.client_id, 'u@example.com');
    expect(rotateRefreshToken(rt, 'vc_other').ok).toBe(false);
  });
});
