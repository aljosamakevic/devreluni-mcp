// Phase 05a D-03-5 — Unit tests for src/ratelimit/magic-link-ip.ts.
//
// Locks the 5/hour fixed-window math, the rate_limits key prefix
// ('magic:ip:<hash>'), and the retryAfterSec computation.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetDbForTests, getDb } from '../db/connection.js';
import {
  MAGIC_LINK_IP_LIMIT,
  MAGIC_LINK_IP_WINDOW_SECONDS,
  checkAndIncrementMagicLinkIp,
} from './magic-link-ip.js';

const DB_PATH = join(
  tmpdir(),
  `vetoed-test-magicip-${randomBytes(6).toString('hex')}.db`
);

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
  db.exec('DELETE FROM rate_limits;');
});

afterAll(() => {
  cleanup();
});

const IP_HASH_A = 'a'.repeat(64);
const IP_HASH_B = 'b'.repeat(64);

describe('checkAndIncrementMagicLinkIp', () => {
  it('allows the first MAGIC_LINK_IP_LIMIT requests', () => {
    for (let i = 0; i < MAGIC_LINK_IP_LIMIT; i++) {
      const r = checkAndIncrementMagicLinkIp(IP_HASH_A);
      expect(r.allowed).toBe(true);
      expect(r.retryAfterSec).toBe(0);
    }
  });

  it('denies the (LIMIT + 1)th request with positive retryAfterSec', () => {
    for (let i = 0; i < MAGIC_LINK_IP_LIMIT; i++) {
      checkAndIncrementMagicLinkIp(IP_HASH_A);
    }
    const r = checkAndIncrementMagicLinkIp(IP_HASH_A);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(MAGIC_LINK_IP_WINDOW_SECONDS);
    expect(r.remaining).toBe(0);
  });

  it('isolates quotas across distinct IP hashes', () => {
    for (let i = 0; i < MAGIC_LINK_IP_LIMIT; i++) {
      checkAndIncrementMagicLinkIp(IP_HASH_A);
    }
    // IP A is now at cap; IP B should still be allowed.
    expect(checkAndIncrementMagicLinkIp(IP_HASH_A).allowed).toBe(false);
    expect(checkAndIncrementMagicLinkIp(IP_HASH_B).allowed).toBe(true);
  });

  it('writes under the magic:ip: key prefix (not signup:ip:)', () => {
    checkAndIncrementMagicLinkIp(IP_HASH_A);
    const db = getDb();
    const rows = db
      .prepare('SELECT key FROM rate_limits')
      .all() as Array<{ key: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.key).toBe(`magic:ip:${IP_HASH_A}`);
    // Sanity: distinct from the signup-ip prefix so a /signup-burned IP can
    // still try /auth/magic-link/request and vice versa.
    expect(rows[0]!.key.startsWith('signup:ip:')).toBe(false);
  });

  it('resets the window after MAGIC_LINK_IP_WINDOW_SECONDS', () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-06-14T12:00:00.000Z').getTime();
      vi.setSystemTime(start);
      for (let i = 0; i < MAGIC_LINK_IP_LIMIT; i++) {
        checkAndIncrementMagicLinkIp(IP_HASH_A);
      }
      expect(checkAndIncrementMagicLinkIp(IP_HASH_A).allowed).toBe(false);

      // Advance past the window.
      vi.setSystemTime(start + MAGIC_LINK_IP_WINDOW_SECONDS * 1000 + 1000);
      const r = checkAndIncrementMagicLinkIp(IP_HASH_A);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(MAGIC_LINK_IP_LIMIT - 1);
    } finally {
      vi.useRealTimers();
    }
  });
});
