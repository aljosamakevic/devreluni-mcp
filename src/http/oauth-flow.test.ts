/**
 * Phase 14 — end-to-end OAuth 2.1 + PKCE handshake against the real HTTP
 * handlers (supertest, no network): register → authorize → magic-link
 * callback → token → the issued access token validates as a normal bearer.
 * This is the pre-merge gate for the live auth flow.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { existsSync, rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetDbForTests, getDb } from '../db/connection.js';
import { registerOAuthRoutes } from './oauth-routes.js';
import { issueMagicLink } from '../auth/magic-link.js';
import { validateToken } from '../auth/tokens.js';

const DB_PATH = join(tmpdir(), `vetoed-test-oauthflow-${randomBytes(6).toString('hex')}.db`);
const BASE = 'https://test.local';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makeApp(): express.Express {
  const app = express();
  registerOAuthRoutes(app, BASE);
  return app;
}

beforeAll(() => {
  process.env['VETOED_DB_PATH'] = DB_PATH;
  delete process.env['RESEND_API_KEY']; // email disabled → issueMagicLink still mints the link
  __resetDbForTests();
  getDb();
});
beforeEach(() => {
  getDb().exec('DELETE FROM oauth_codes; DELETE FROM oauth_refresh_tokens; DELETE FROM oauth_clients; DELETE FROM oauth_authorize_requests; DELETE FROM magic_link_tokens; DELETE FROM tokens;');
});
afterAll(() => {
  __resetDbForTests();
  for (const s of ['', '-wal', '-shm']) if (existsSync(`${DB_PATH}${s}`)) try { rmSync(`${DB_PATH}${s}`); } catch { /* best-effort */ }
});

describe('discovery metadata', () => {
  it('serves protected-resource + authorization-server metadata', async () => {
    const app = makeApp();
    const prm = await request(app).get('/.well-known/oauth-protected-resource');
    expect(prm.status).toBe(200);
    expect(prm.body.resource).toBe(`${BASE}/mcp`);
    expect(prm.body.authorization_servers).toContain(BASE);

    const asm = await request(app).get('/.well-known/oauth-authorization-server');
    expect(asm.status).toBe(200);
    expect(asm.body.code_challenge_methods_supported).toEqual(['S256']);
    expect(asm.body.token_endpoint).toBe(`${BASE}/token`);
  });

  it('also serves the RFC 9728 path-suffixed + openid-configuration variants', async () => {
    const app = makeApp();
    // Clients that construct the path-suffixed metadata URL from the resource id.
    const prmPath = await request(app).get('/.well-known/oauth-protected-resource/mcp');
    expect(prmPath.status).toBe(200);
    expect(prmPath.body.resource).toBe(`${BASE}/mcp`);
    const oidc = await request(app).get('/.well-known/openid-configuration');
    expect(oidc.status).toBe(200);
    expect(oidc.body.token_endpoint).toBe(`${BASE}/token`);
  });
});

describe('full authorization_code + PKCE flow', () => {
  it('register → authorize → callback → token → validates as a bearer', async () => {
    const app = makeApp();

    // 1. Dynamic client registration.
    const reg = await request(app).post('/register').send({ client_name: 'claude.ai', redirect_uris: [REDIRECT] });
    expect(reg.status).toBe(201);
    const clientId = reg.body.client_id as string;
    expect(clientId).toMatch(/^vc_/);

    // 2. PKCE pair + authorize request.
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const authz = await request(app).get('/authorize').query({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz123',
      scope: 'mcp',
    });
    expect(authz.status).toBe(200);
    const areq = /name="areq" value="([^"]+)"/.exec(authz.text)?.[1];
    expect(areq).toBeTruthy();

    // 3. Magic-link step. (POST /authorize/login emails the link; here we mint
    // the link directly to obtain the plaintext the user would click.)
    const link = issueMagicLink('founder@example.com');
    const cb = await request(app).get('/oauth/callback').query({ token: link.plaintext, areq: areq! });
    expect(cb.status).toBe(302);
    const loc = new URL(cb.headers['location'] as string);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get('state')).toBe('xyz123');
    const code = loc.searchParams.get('code');
    expect(code).toBeTruthy();

    // 4. Token exchange.
    const tok = await request(app).post('/token').type('form').send({
      grant_type: 'authorization_code',
      code: code!,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    });
    expect(tok.status).toBe(200);
    expect(tok.body.token_type).toBe('Bearer');
    const accessToken = tok.body.access_token as string;
    expect(accessToken).toMatch(/^pv_/); // mints into the existing tokens table
    expect(tok.body.refresh_token).toMatch(/^vrt_/);

    // 5. The issued access token validates as a normal bearer.
    const validated = validateToken(accessToken);
    expect(validated).not.toBeNull();
    expect(validated!.email).toBe('founder@example.com');
  });

  it('rejects token exchange with a wrong PKCE verifier', async () => {
    const app = makeApp();
    const reg = await request(app).post('/register').send({ redirect_uris: [REDIRECT] });
    const clientId = reg.body.client_id as string;
    const challenge = b64url(createHash('sha256').update('the-real-verifier').digest());
    const authz = await request(app).get('/authorize').query({
      response_type: 'code', client_id: clientId, redirect_uri: REDIRECT,
      code_challenge: challenge, code_challenge_method: 'S256',
    });
    const areq = /name="areq" value="([^"]+)"/.exec(authz.text)![1];
    const link = issueMagicLink('founder@example.com');
    const cb = await request(app).get('/oauth/callback').query({ token: link.plaintext, areq });
    const code = new URL(cb.headers['location'] as string).searchParams.get('code')!;
    const tok = await request(app).post('/token').type('form').send({
      grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: 'WRONG',
    });
    expect(tok.status).toBe(400);
    expect(tok.body.error).toBe('invalid_grant');
  });

  it('rejects authorize with an unregistered redirect_uri', async () => {
    const app = makeApp();
    const reg = await request(app).post('/register').send({ redirect_uris: [REDIRECT] });
    const r = await request(app).get('/authorize').query({
      response_type: 'code', client_id: reg.body.client_id, redirect_uri: 'https://evil.example/cb',
      code_challenge: 'x', code_challenge_method: 'S256',
    });
    expect(r.status).toBe(400);
  });
});
