// Phase 03 T15 — Unit tests for src/ratelimit/per-token.ts +
// src/ratelimit/middleware.ts.
//
// Locks the sliding-window math (PLAN T11), the rate_limited row exclusion
// (sliding-window WHERE filter), and the middleware response shape
// (429 + Retry-After + JSON body per PLAN T13). Uses a unique temp SQLite
// path per file so tests don't pollute the dev DB.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { __resetDbForTests, getDb } from '../db/connection.js';
import { issueToken } from '../auth/tokens.js';
import { authRequired } from '../auth/middleware.js';
import '../auth/types.js';
import { checkPerTokenLimit, PER_TOKEN_LIMIT } from './per-token.js';
import { rateLimit } from './middleware.js';

const DB_PATH = join(tmpdir(), `vetoed-test-pertoken-${randomBytes(6).toString('hex')}.db`);

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

beforeAll(() => {
  process.env['VETOED_DB_PATH'] = DB_PATH;
  cleanup();
  getDb();
});

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM usage_log;');
  db.exec('DELETE FROM tokens;');
});

afterAll(() => {
  cleanup();
});

// Insert N usage_log rows for tokenId with a given offset (negative = past).
function seedUsage(
  tokenId: number,
  count: number,
  opts: { status?: string; ageMinutes?: number } = {}
): void {
  const status = opts.status ?? 'ok';
  const ageMinutes = opts.ageMinutes ?? 1;
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO usage_log (token_id, tool_name, duration_ms, status, created_at)
     VALUES (?, 'test_tool', 10, ?, datetime('now', ?))`
  );
  const txn = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      // Use a slight per-row offset so MIN(created_at) is deterministic.
      insert.run(tokenId, status, `-${ageMinutes} minutes`);
    }
  });
  txn();
}

describe('checkPerTokenLimit — under threshold', () => {
  it('allows when count is 0', () => {
    const result = checkPerTokenLimit(1);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(PER_TOKEN_LIMIT);
    expect(result.retryAfterSec).toBe(0);
  });

  it('allows at count=399 (PER_TOKEN_LIMIT-1), remaining=1', () => {
    const issued = issueToken('seed399@example.com');
    seedUsage(issued.id, 399);
    const result = checkPerTokenLimit(issued.id);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
    expect(result.retryAfterSec).toBe(0);
  });
});

describe('checkPerTokenLimit — at and over threshold', () => {
  it('blocks at count=400 (the 401st request scenario): allowed=false, retryAfterSec > 0', () => {
    const issued = issueToken('seed400@example.com');
    seedUsage(issued.id, 400);
    const result = checkPerTokenLimit(issued.id);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSec).toBeGreaterThan(0);
    // Upper bound: just under 24h in seconds.
    expect(result.retryAfterSec).toBeLessThanOrEqual(24 * 60 * 60);
  });

  it('blocks at count=600 too (no off-by-one above the threshold)', () => {
    const issued = issueToken('seed600@example.com');
    seedUsage(issued.id, 600);
    const result = checkPerTokenLimit(issued.id);
    expect(result.allowed).toBe(false);
  });
});

describe('checkPerTokenLimit — sliding window excludes stale + rate_limited rows', () => {
  it('returns allowed=true when 500 rows exist but are dated > 24h ago', () => {
    const issued = issueToken('stale@example.com');
    // 25h ago — outside the 24h window.
    seedUsage(issued.id, 500, { ageMinutes: 25 * 60 });
    const result = checkPerTokenLimit(issued.id);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(PER_TOKEN_LIMIT);
  });

  it('excludes status=rate_limited rows from the count', () => {
    const issued = issueToken('ratelimited@example.com');
    // 400 rate_limited rows would otherwise cap us, but the WHERE filter excludes them.
    seedUsage(issued.id, 400, { status: 'rate_limited' });
    // Plus 5 ok rows that DO count.
    seedUsage(issued.id, 5, { status: 'ok' });
    const result = checkPerTokenLimit(issued.id);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(PER_TOKEN_LIMIT - 5);
  });
});

describe('rateLimit middleware (via supertest)', () => {
  function makeApp() {
    const app = express();
    app.use(express.json());
    app.post('/mcp', authRequired, rateLimit, (req: Request, res: Response) => {
      res.status(200).json({ ok: true, tokenId: req.tokenId });
    });
    return app;
  }

  it('passes through when under the threshold', async () => {
    const issued = issueToken('under@example.com');
    const app = makeApp();
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${issued.token}`)
      .send({ jsonrpc: '2.0', method: 'ping' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 429 + Retry-After + correct JSON body when capped', async () => {
    const issued = issueToken('capped@example.com');
    seedUsage(issued.id, PER_TOKEN_LIMIT);
    const app = makeApp();
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${issued.token}`)
      .send({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'x' } });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.body).toMatchObject({
      error: 'rate_limited',
      reason: 'per_token_limit_exceeded',
    });
    expect(typeof res.body.retry_after_sec).toBe('number');
    expect(res.body.retry_after_sec).toBeGreaterThan(0);
  });

  it('records a status=rate_limited row when capped (audit trail)', async () => {
    const issued = issueToken('audit@example.com');
    seedUsage(issued.id, PER_TOKEN_LIMIT);
    const app = makeApp();
    await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${issued.token}`)
      .send({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'some_tool' } });
    const db = getDb();
    const row = db
      .prepare(
        `SELECT count(*) AS c FROM usage_log
         WHERE token_id = ? AND status = 'rate_limited' AND tool_name = 'some_tool'`
      )
      .get(issued.id) as { c: number };
    expect(row.c).toBe(1);
  });
});
