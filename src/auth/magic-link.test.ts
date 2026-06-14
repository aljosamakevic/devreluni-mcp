// Phase 05a D-03-5 — Unit tests for src/auth/magic-link.ts.
//
// Locks the contracts:
//   - Issue then peek/mark happy path → returns email, marks one row.
//   - Re-mark same token → returns false (already used / idempotent guard).
//   - peek after expiry (fake timers) → status='expired'.
//   - peek bogus token → null.
//   - Plaintext never appears in the stored row (sha256 only).
//   - Each issuance produces a distinct plaintext.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetDbForTests, getDb } from '../db/connection.js';
import {
  MAGIC_LINK_TTL_MS,
  cleanupExpiredMagicLinks,
  issueMagicLink,
  markMagicLinkUsed,
  peekMagicLink,
} from './magic-link.js';
import { issueToken } from './tokens.js';

const DB_PATH = join(
  tmpdir(),
  `vetoed-test-magiclink-${randomBytes(6).toString('hex')}.db`
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
  db.exec('DELETE FROM magic_link_tokens;');
  db.exec('DELETE FROM tokens;');
});

afterAll(() => {
  cleanup();
});

describe('issueMagicLink', () => {
  it('returns plaintext + id + expiresAt for a fresh row', () => {
    const r = issueMagicLink('alice@example.com');
    expect(typeof r.plaintext).toBe('string');
    expect(r.plaintext.length).toBeGreaterThan(40); // 32 bytes base64url ≈ 43
    expect(typeof r.id).toBe('number');
    expect(typeof r.expiresAt).toBe('string');

    const expiresMs = Date.parse(r.expiresAt);
    expect(Number.isNaN(expiresMs)).toBe(false);
    // expiresAt should land within MAGIC_LINK_TTL_MS of now (allow 5s skew).
    const expectedMs = Date.now() + MAGIC_LINK_TTL_MS;
    expect(Math.abs(expiresMs - expectedMs)).toBeLessThan(5000);
  });

  it('does NOT store the plaintext anywhere in the row', () => {
    const { plaintext } = issueMagicLink('bob@example.com');
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM magic_link_tokens')
      .all() as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (typeof value === 'string') {
          expect(value.includes(plaintext)).toBe(false);
        }
      }
    }
  });

  it('produces a distinct plaintext per issuance', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const { plaintext } = issueMagicLink('carol@example.com');
      expect(seen.has(plaintext)).toBe(false);
      seen.add(plaintext);
    }
  });

  it('lowercases email_normalized but preserves the input email casing', () => {
    issueMagicLink('Dave@Example.COM');
    const db = getDb();
    const row = db
      .prepare('SELECT email, email_normalized FROM magic_link_tokens LIMIT 1')
      .get() as { email: string; email_normalized: string };
    expect(row.email).toBe('Dave@Example.COM');
    expect(row.email_normalized).toBe('dave@example.com');
  });

  it('throws when email is empty', () => {
    expect(() => issueMagicLink('   ')).toThrow();
  });
});

describe('peekMagicLink', () => {
  it('returns { email, status: "ok" } for a fresh, unused token', () => {
    const { plaintext } = issueMagicLink('erin@example.com');
    const peek = peekMagicLink(plaintext);
    expect(peek).not.toBeNull();
    expect(peek!.email).toBe('erin@example.com');
    expect(peek!.status).toBe('ok');
  });

  it('does NOT mutate the row (used_at stays null)', () => {
    const { plaintext } = issueMagicLink('frank@example.com');
    peekMagicLink(plaintext);
    peekMagicLink(plaintext);
    const db = getDb();
    const row = db
      .prepare('SELECT used_at FROM magic_link_tokens LIMIT 1')
      .get() as { used_at: string | null };
    expect(row.used_at).toBeNull();
  });

  it('returns null for a bogus token', () => {
    expect(peekMagicLink('not-a-real-token')).toBeNull();
    expect(peekMagicLink('')).toBeNull();
  });

  it('returns status=expired once the TTL has elapsed', () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-06-14T12:00:00.000Z').getTime();
      vi.setSystemTime(start);
      const { plaintext } = issueMagicLink('grace@example.com');

      vi.setSystemTime(start + MAGIC_LINK_TTL_MS - 1000); // still valid
      expect(peekMagicLink(plaintext)!.status).toBe('ok');

      vi.setSystemTime(start + MAGIC_LINK_TTL_MS + 1000); // expired
      const expired = peekMagicLink(plaintext);
      expect(expired).not.toBeNull();
      expect(expired!.status).toBe('expired');
      expect(expired!.email).toBe('grace@example.com');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('markMagicLinkUsed', () => {
  it('flips used_at and binds consumed_token_id on first call', () => {
    const { plaintext } = issueMagicLink('henry@example.com');
    const bearer = issueToken('henry@example.com');
    const ok = markMagicLinkUsed(plaintext, bearer.id);
    expect(ok).toBe(true);

    const db = getDb();
    const row = db
      .prepare(
        'SELECT used_at, consumed_token_id FROM magic_link_tokens LIMIT 1'
      )
      .get() as { used_at: string | null; consumed_token_id: number | null };
    expect(row.used_at).not.toBeNull();
    expect(row.consumed_token_id).toBe(bearer.id);
  });

  it('returns false on the second call (one-time-use enforced)', () => {
    const { plaintext } = issueMagicLink('iris@example.com');
    const b1 = issueToken('iris@example.com');
    const b2 = issueToken('iris@example.com');
    expect(markMagicLinkUsed(plaintext, b1.id)).toBe(true);
    expect(markMagicLinkUsed(plaintext, b2.id)).toBe(false);

    const db = getDb();
    const row = db
      .prepare('SELECT consumed_token_id FROM magic_link_tokens LIMIT 1')
      .get() as { consumed_token_id: number };
    // First bearer wins; second is ignored.
    expect(row.consumed_token_id).toBe(b1.id);
  });

  it('peekMagicLink after mark returns status=used', () => {
    const { plaintext } = issueMagicLink('jane@example.com');
    const bearer = issueToken('jane@example.com');
    markMagicLinkUsed(plaintext, bearer.id);
    const peek = peekMagicLink(plaintext);
    expect(peek!.status).toBe('used');
  });

  it('returns false for a bogus plaintext', () => {
    expect(markMagicLinkUsed('bogus', 1)).toBe(false);
    expect(markMagicLinkUsed('', 1)).toBe(false);
  });
});

describe('cleanupExpiredMagicLinks', () => {
  it('deletes rows expired more than 1 day ago', () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-06-14T12:00:00.000Z').getTime();
      vi.setSystemTime(start);
      issueMagicLink('kate@example.com');
      issueMagicLink('leo@example.com');

      // Jump forward 2 days. Both rows are expired by more than 1 day, both unused.
      vi.setSystemTime(start + 2 * 24 * 60 * 60 * 1000);
      const deleted = cleanupExpiredMagicLinks();
      expect(deleted).toBe(2);

      const db = getDb();
      const c = db
        .prepare('SELECT COUNT(*) as c FROM magic_link_tokens')
        .get() as { c: number };
      expect(c.c).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps rows that are still within the 1-day grace window', () => {
    const { plaintext } = issueMagicLink('mia@example.com');
    const deleted = cleanupExpiredMagicLinks();
    expect(deleted).toBe(0);

    // Row should still be retrievable.
    expect(peekMagicLink(plaintext)).not.toBeNull();
  });
});
