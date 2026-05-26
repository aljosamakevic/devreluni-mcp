// Phase 03 T10 — Unit tests for src/auth/middleware.ts.
//
// Wires authRequired onto a minimal Express app and exercises happy + 401
// paths via supertest. Locks the WWW-Authenticate header to the exact
// string `Bearer realm="vetoed"` (T08 — single source of truth in the
// middleware module).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { __resetDbForTests, getDb } from '../db/connection.js';
import { issueToken } from './tokens.js';
import { authRequired } from './middleware.js';
import './types.js';

const DB_PATH = join(tmpdir(), `vetoed-test-middleware-${randomBytes(6).toString('hex')}.db`);

function cleanup(): void {
  __resetDbForTests();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${DB_PATH}${suffix}`;
    if (existsSync(p)) {
      try {
        rmSync(p);
      } catch {
        // best-effort
      }
    }
  }
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.post('/mcp', authRequired, (req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      tokenId: req.tokenId ?? null,
      tokenEmail: req.tokenEmail ?? null,
      // Echo the body so we can prove authRequired didn't mutate it.
      echo: req.body,
    });
  });
  return app;
}

beforeAll(() => {
  process.env['VETOED_DB_PATH'] = DB_PATH;
  cleanup();
  getDb();
});

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM tokens;');
});

afterAll(() => {
  cleanup();
});

describe('authRequired — missing header', () => {
  it("returns 401 with WWW-Authenticate: Bearer realm=\"vetoed\" when header is absent", async () => {
    const app = makeApp();
    const res = await request(app).post('/mcp').send({ jsonrpc: '2.0', method: 'ping' });
    expect(res.status).toBe(401);
    // Exact-string lock per T08.
    expect(res.headers['www-authenticate']).toBe('Bearer realm="vetoed"');
    expect(res.body).toEqual({
      error: 'unauthorized',
      reason: 'missing_or_malformed_authorization_header',
    });
  });

  it("returns 401 when scheme is not Bearer", async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Basic abc:def')
      .send({});
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer realm="vetoed"');
    expect(res.body.reason).toBe('missing_or_malformed_authorization_header');
  });

  it("returns 401 when Bearer is present but token is empty", async () => {
    const app = makeApp();
    const res = await request(app).post('/mcp').set('Authorization', 'Bearer   ').send({});
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('missing_or_malformed_authorization_header');
  });
});

describe('authRequired — invalid token', () => {
  it("returns 401 + reason='invalid_or_revoked_token' for an unknown token", async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer pv_bogus_never_issued')
      .send({});
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer realm="vetoed"');
    expect(res.body).toEqual({
      error: 'unauthorized',
      reason: 'invalid_or_revoked_token',
    });
  });
});

describe('authRequired — happy path', () => {
  it("passes through with a valid token, attaches req.tokenId + req.tokenEmail, leaves body intact", async () => {
    const issued = issueToken('happy@example.com');
    const app = makeApp();
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${issued.token}`)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.tokenId).toBe(issued.id);
    expect(res.body.tokenEmail).toBe('happy@example.com');
    expect(res.body.echo).toEqual(body);
  });
});
