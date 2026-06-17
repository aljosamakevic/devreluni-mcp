/**
 * Phase 14 — per-user limiter aggregates across all of a user's tokens, so a
 * user can't multiply their quota by minting more tokens (the OAuth-refresh
 * concern). Same 400/24h window as per-token.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetDbForTests, getDb } from '../db/connection.js';
import { issueToken } from '../auth/tokens.js';
import { checkPerUserLimit, PER_USER_LIMIT } from './per-user.js';

const DB_PATH = join(tmpdir(), `vetoed-test-peruser-${randomBytes(6).toString('hex')}.db`);

function seedUsage(tokenId: number, n: number): void {
  const db = getDb();
  const stmt = db.prepare(`INSERT INTO usage_log (token_id, tool_name, duration_ms, status, created_at) VALUES (?, 'x', 1, 'ok', ?)`);
  const now = new Date().toISOString();
  for (let i = 0; i < n; i++) stmt.run(tokenId, now);
}

beforeAll(() => {
  process.env['VETOED_DB_PATH'] = DB_PATH;
  __resetDbForTests();
  getDb();
});
beforeEach(() => {
  getDb().exec('DELETE FROM usage_log; DELETE FROM tokens;');
});
afterAll(() => {
  __resetDbForTests();
  for (const s of ['', '-wal', '-shm']) if (existsSync(`${DB_PATH}${s}`)) try { rmSync(`${DB_PATH}${s}`); } catch { /* best-effort */ }
});

describe('checkPerUserLimit', () => {
  it('aggregates usage across multiple tokens of the same user', () => {
    const t1 = issueToken('user@example.com');
    const t2 = issueToken('user@example.com'); // e.g. an OAuth refresh-minted token
    seedUsage(t1.id, PER_USER_LIMIT - 1);
    expect(checkPerUserLimit('user@example.com').allowed).toBe(true);
    seedUsage(t2.id, 1); // total now == limit, split across two tokens
    const check = checkPerUserLimit('user@example.com');
    expect(check.allowed).toBe(false);
    expect(check.retryAfterSec).toBeGreaterThan(0);
  });

  it('does not count another user toward this user', () => {
    const mine = issueToken('me@example.com');
    const other = issueToken('other@example.com');
    seedUsage(other.id, PER_USER_LIMIT);
    seedUsage(mine.id, 1);
    expect(checkPerUserLimit('me@example.com').allowed).toBe(true);
    expect(checkPerUserLimit('other@example.com').allowed).toBe(false);
  });
});
