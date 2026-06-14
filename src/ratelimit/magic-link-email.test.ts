// Phase 05a D-03-5 — Unit tests for src/ratelimit/magic-link-email.ts.
//
// Locks the 5/hour fixed-window math, the rate_limits key prefix
// ('magic:email:<hash>'), the hashEmailForRateLimit helper, and that
// case-only differences hash to the same bucket.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetDbForTests, getDb } from '../db/connection.js';
import {
  MAGIC_LINK_EMAIL_LIMIT,
  MAGIC_LINK_EMAIL_WINDOW_SECONDS,
  checkAndIncrementMagicLinkEmail,
  hashEmailForRateLimit,
} from './magic-link-email.js';

const DB_PATH = join(
  tmpdir(),
  `vetoed-test-magicemail-${randomBytes(6).toString('hex')}.db`
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

describe('hashEmailForRateLimit', () => {
  it('returns a 64-char sha256 hex digest', () => {
    const h = hashEmailForRateLimit('alice@example.com');
    expect(h.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(h)).toBe(true);
  });

  it('lowercases and trims so casing/whitespace collide to the same bucket', () => {
    expect(hashEmailForRateLimit('Alice@Example.com')).toBe(
      hashEmailForRateLimit('alice@example.com')
    );
    expect(hashEmailForRateLimit('  ALICE@EXAMPLE.COM  ')).toBe(
      hashEmailForRateLimit('alice@example.com')
    );
  });

  it('differs across distinct emails', () => {
    expect(hashEmailForRateLimit('a@example.com')).not.toBe(
      hashEmailForRateLimit('b@example.com')
    );
  });
});

describe('checkAndIncrementMagicLinkEmail', () => {
  const EMAIL_HASH_A = hashEmailForRateLimit('alice@example.com');
  const EMAIL_HASH_B = hashEmailForRateLimit('bob@example.com');

  it('allows the first MAGIC_LINK_EMAIL_LIMIT requests', () => {
    for (let i = 0; i < MAGIC_LINK_EMAIL_LIMIT; i++) {
      const r = checkAndIncrementMagicLinkEmail(EMAIL_HASH_A);
      expect(r.allowed).toBe(true);
      expect(r.retryAfterSec).toBe(0);
    }
  });

  it('denies the (LIMIT + 1)th request with positive retryAfterSec', () => {
    for (let i = 0; i < MAGIC_LINK_EMAIL_LIMIT; i++) {
      checkAndIncrementMagicLinkEmail(EMAIL_HASH_A);
    }
    const r = checkAndIncrementMagicLinkEmail(EMAIL_HASH_A);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(MAGIC_LINK_EMAIL_WINDOW_SECONDS);
  });

  it('isolates quotas across distinct emails', () => {
    for (let i = 0; i < MAGIC_LINK_EMAIL_LIMIT; i++) {
      checkAndIncrementMagicLinkEmail(EMAIL_HASH_A);
    }
    expect(checkAndIncrementMagicLinkEmail(EMAIL_HASH_A).allowed).toBe(false);
    expect(checkAndIncrementMagicLinkEmail(EMAIL_HASH_B).allowed).toBe(true);
  });

  it('writes under magic:email: prefix (distinct from magic:ip: and signup:ip:)', () => {
    checkAndIncrementMagicLinkEmail(EMAIL_HASH_A);
    const db = getDb();
    const rows = db
      .prepare('SELECT key FROM rate_limits')
      .all() as Array<{ key: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.key).toBe(`magic:email:${EMAIL_HASH_A}`);
    expect(rows[0]!.key.startsWith('magic:ip:')).toBe(false);
    expect(rows[0]!.key.startsWith('signup:ip:')).toBe(false);
  });

  it('resets the window after MAGIC_LINK_EMAIL_WINDOW_SECONDS', () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-06-14T12:00:00.000Z').getTime();
      vi.setSystemTime(start);
      for (let i = 0; i < MAGIC_LINK_EMAIL_LIMIT; i++) {
        checkAndIncrementMagicLinkEmail(EMAIL_HASH_A);
      }
      expect(checkAndIncrementMagicLinkEmail(EMAIL_HASH_A).allowed).toBe(false);

      vi.setSystemTime(start + MAGIC_LINK_EMAIL_WINDOW_SECONDS * 1000 + 1000);
      expect(checkAndIncrementMagicLinkEmail(EMAIL_HASH_A).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
