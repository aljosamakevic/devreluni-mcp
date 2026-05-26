// Phase 03 T28 — Unit tests for src/http/admin-api.ts.
//
// Drives a minimal Express app with the admin gate + API mounted, using
// supertest. Covers:
//   * happy paths: list / issue / revoke / usage
//   * 400 on missing or malformed email
//   * 404 on revoking a non-existent id
//   * 401 when unauthenticated (gate inherited from T27)
//   * 500 when ADMIN_PASSWORD is unset (gate fails closed)

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { __resetDbForTests, getDb } from '../db/connection.js';
import { adminAuthRequired } from '../auth/admin-middleware.js';
import { registerAdminApi } from './admin-api.js';
import { issueToken } from '../auth/tokens.js';

const DB_PATH = join(tmpdir(), `vetoed-test-admin-api-${randomBytes(6).toString('hex')}.db`);
const VALID_PASSWORD = 'hunter2hunter2';

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
  app.use('/admin', adminAuthRequired);
  registerAdminApi(app, getDb());
  return app;
}

const ORIGINAL_PASSWORD = process.env['ADMIN_PASSWORD'];

beforeAll(() => {
  process.env['VETOED_DB_PATH'] = DB_PATH;
  cleanup();
  getDb();
});

beforeEach(() => {
  process.env['ADMIN_PASSWORD'] = VALID_PASSWORD;
  const db = getDb();
  db.exec('DELETE FROM usage_log;');
  db.exec('DELETE FROM tokens;');
});

afterEach(() => {
  if (typeof ORIGINAL_PASSWORD === 'string') process.env['ADMIN_PASSWORD'] = ORIGINAL_PASSWORD;
  else delete process.env['ADMIN_PASSWORD'];
});

afterAll(() => {
  cleanup();
});

describe('GET /admin/api/tokens', () => {
  it('returns an empty array when no tokens exist', async () => {
    const app = makeApp();
    const res = await request(app)
      .get('/admin/api/tokens')
      .auth('admin', VALID_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns issued tokens with prefix only (no plaintext, no hash)', async () => {
    const issued = issueToken('alice@example.com');
    const app = makeApp();
    const res = await request(app)
      .get('/admin/api/tokens')
      .auth('admin', VALID_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const row = res.body[0];
    expect(row.id).toBe(issued.id);
    expect(row.email).toBe('alice@example.com');
    expect(row.prefix).toBe(issued.prefix);
    expect(row.status).toBe('active');
    // Critical: never expose plaintext or hash.
    expect(row.token).toBeUndefined();
    expect(row.token_hash).toBeUndefined();
  });
});

describe('POST /admin/api/tokens', () => {
  it('issues a new token and returns id + token + prefix', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/admin/api/tokens')
      .auth('admin', VALID_PASSWORD)
      .send({ email: 'bob@example.com' });
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('number');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.startsWith('pv_')).toBe(true);
    expect(res.body.prefix).toBe(res.body.token.slice(0, 7));
  });

  it('returns 400 when email is missing', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/admin/api/tokens')
      .auth('admin', VALID_PASSWORD)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('email_required');
  });

  it('returns 400 when email is empty string', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/admin/api/tokens')
      .auth('admin', VALID_PASSWORD)
      .send({ email: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('email_required');
  });

  it('returns 400 when email is malformed', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/admin/api/tokens')
      .auth('admin', VALID_PASSWORD)
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('email_malformed');
  });
});

describe('DELETE /admin/api/tokens/:id', () => {
  it('revokes an existing token', async () => {
    const issued = issueToken('carol@example.com');
    const app = makeApp();
    const res = await request(app)
      .delete(`/admin/api/tokens/${issued.id}`)
      .auth('admin', VALID_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revoked: true });
  });

  it('returns 404 when token id does not exist', async () => {
    const app = makeApp();
    const res = await request(app)
      .delete('/admin/api/tokens/9999')
      .auth('admin', VALID_PASSWORD);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('returns 404 when token already revoked (idempotent failure)', async () => {
    const issued = issueToken('dave@example.com');
    const app = makeApp();
    await request(app)
      .delete(`/admin/api/tokens/${issued.id}`)
      .auth('admin', VALID_PASSWORD);
    const res = await request(app)
      .delete(`/admin/api/tokens/${issued.id}`)
      .auth('admin', VALID_PASSWORD);
    expect(res.status).toBe(404);
  });

  it('returns 400 when id is non-numeric', async () => {
    const app = makeApp();
    const res = await request(app)
      .delete('/admin/api/tokens/not-a-number')
      .auth('admin', VALID_PASSWORD);
    expect(res.status).toBe(400);
  });
});

describe('GET /admin/api/usage', () => {
  it('returns rows joined to tokens.email, ordered DESC by created_at', async () => {
    const issued = issueToken('eve@example.com');
    const db = getDb();
    db.prepare(
      `INSERT INTO usage_log (token_id, tool_name, duration_ms, status, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(issued.id, 'tool_a', 50, 'ok', '2026-05-25T10:00:00.000Z');
    db.prepare(
      `INSERT INTO usage_log (token_id, tool_name, duration_ms, status, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(issued.id, 'tool_b', 75, 'ok', '2026-05-26T10:00:00.000Z');

    const app = makeApp();
    const res = await request(app)
      .get('/admin/api/usage')
      .auth('admin', VALID_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // DESC by created_at: tool_b first.
    expect(res.body[0].tool_name).toBe('tool_b');
    expect(res.body[1].tool_name).toBe('tool_a');
    expect(res.body[0].email).toBe('eve@example.com');
    expect(res.body[0].duration_ms).toBe(75);
  });

  it('caps at 100 rows', async () => {
    const issued = issueToken('frank@example.com');
    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO usage_log (token_id, tool_name, duration_ms, status, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (let i = 0; i < 105; i++) {
      insert.run(issued.id, `tool_${i}`, i, 'ok', `2026-05-26T10:${String(i % 60).padStart(2, '0')}:00.000Z`);
    }

    const app = makeApp();
    const res = await request(app)
      .get('/admin/api/usage')
      .auth('admin', VALID_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(100);
  });
});

describe('admin API auth gate', () => {
  it('returns 401 on unauthenticated requests when ADMIN_PASSWORD is set', async () => {
    const app = makeApp();
    const res = await request(app).get('/admin/api/tokens');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="vetoed-admin"');
  });

  it('returns 500 admin_disabled when ADMIN_PASSWORD is unset (gate fails closed)', async () => {
    delete process.env['ADMIN_PASSWORD'];
    const app = makeApp();
    const res = await request(app)
      .get('/admin/api/tokens')
      .auth('admin', 'anything');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: 'admin_disabled',
      message: 'ADMIN_PASSWORD not configured',
    });
  });
});
