// Phase 03 T10 — Unit tests for src/auth/tokens.ts.
//
// Uses a unique temp SQLite path per file so tests don't pollute the dev DB
// at ./vetoed.db. __resetDbForTests() drops the singleton between cases.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetDbForTests, getDb } from '../db/connection.js';
import { issueToken, listTokens, revokeToken, validateToken } from './tokens.js';

const DB_PATH = join(tmpdir(), `vetoed-test-tokens-${randomBytes(6).toString('hex')}.db`);

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
  // Force schema bootstrap.
  getDb();
});

beforeEach(() => {
  // Wipe all rows between cases so id sequence + counts are deterministic.
  const db = getDb();
  db.exec('DELETE FROM tokens;');
});

afterAll(() => {
  cleanup();
});

describe('issueToken', () => {
  it("returns a pv_-prefixed plaintext token", () => {
    const result = issueToken('alice@example.com');
    expect(result.token.startsWith('pv_')).toBe(true);
    expect(result.token.length).toBeGreaterThan(7);
  });

  it("sets prefix to the first 7 chars of plaintext", () => {
    const result = issueToken('alice@example.com');
    expect(result.prefix).toBe(result.token.slice(0, 7));
    expect(result.prefix.length).toBe(7);
    expect(result.prefix.startsWith('pv_')).toBe(true);
  });

  it("creates an active row in the tokens table", () => {
    const result = issueToken('alice@example.com');
    const db = getDb();
    const row = db
      .prepare('SELECT email, token_prefix, status FROM tokens WHERE id = ?')
      .get(result.id) as { email: string; token_prefix: string; status: string };
    expect(row.email).toBe('alice@example.com');
    expect(row.token_prefix).toBe(result.prefix);
    expect(row.status).toBe('active');
  });

  it("never stores the plaintext", () => {
    const result = issueToken('alice@example.com');
    const db = getDb();
    // Search every column of the tokens table for the plaintext.
    const rows = db.prepare('SELECT * FROM tokens').all() as Record<string, unknown>[];
    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (typeof value === 'string') {
          expect(value).not.toBe(result.token);
        }
      }
    }
  });
});

describe('validateToken', () => {
  it("returns {id, email} for a freshly-issued active token", () => {
    const issued = issueToken('bob@example.com');
    const v = validateToken(issued.token);
    expect(v).not.toBeNull();
    expect(v?.id).toBe(issued.id);
    expect(v?.email).toBe('bob@example.com');
  });

  it("updates last_used_at after a successful validation", () => {
    const issued = issueToken('bob@example.com');
    const db = getDb();
    const before = db
      .prepare('SELECT last_used_at FROM tokens WHERE id = ?')
      .get(issued.id) as { last_used_at: string | null };
    expect(before.last_used_at).toBeNull();
    validateToken(issued.token);
    const after = db
      .prepare('SELECT last_used_at FROM tokens WHERE id = ?')
      .get(issued.id) as { last_used_at: string | null };
    expect(typeof after.last_used_at).toBe('string');
    expect(after.last_used_at).not.toBeNull();
  });

  it("returns null for a bogus pv_ token", () => {
    expect(validateToken('pv_bogus_value_that_was_never_issued')).toBeNull();
  });

  it("returns null after the token is revoked", () => {
    const issued = issueToken('carol@example.com');
    expect(validateToken(issued.token)).not.toBeNull();
    expect(revokeToken(issued.id)).toBe(true);
    expect(validateToken(issued.token)).toBeNull();
  });
});

describe('revokeToken', () => {
  it("revokes by numeric id", () => {
    const issued = issueToken('dave@example.com');
    expect(revokeToken(issued.id)).toBe(true);
    expect(validateToken(issued.token)).toBeNull();
  });

  it("revokes by pv_ prefix", () => {
    const issued = issueToken('erin@example.com');
    expect(revokeToken(issued.prefix)).toBe(true);
    expect(validateToken(issued.token)).toBeNull();
  });

  it("returns false when there is no match", () => {
    expect(revokeToken('pv_zzzz')).toBe(false);
    expect(revokeToken(99999)).toBe(false);
  });

  it("does not double-revoke (second call returns false)", () => {
    const issued = issueToken('frank@example.com');
    expect(revokeToken(issued.id)).toBe(true);
    expect(revokeToken(issued.id)).toBe(false);
  });
});

describe('listTokens', () => {
  it("returns prefix-only rows (no plaintext, no hash)", () => {
    const issued = issueToken('grace@example.com');
    const rows = listTokens();
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.prefix).toBe(issued.prefix);
    expect(row.prefix.length).toBe(7);
    expect(row.email).toBe('grace@example.com');
    // Compile-time guarantee + runtime double-check: no plaintext/hash keys.
    const keys = Object.keys(row);
    expect(keys).not.toContain('token');
    expect(keys).not.toContain('token_hash');
    // No string value in the row equals the plaintext.
    for (const value of Object.values(row)) {
      if (typeof value === 'string') {
        expect(value).not.toBe(issued.token);
      }
    }
  });

  it("returns rows in id order", () => {
    issueToken('one@example.com');
    issueToken('two@example.com');
    issueToken('three@example.com');
    const rows = listTokens();
    expect(rows.map((r) => r.email)).toEqual([
      'one@example.com',
      'two@example.com',
      'three@example.com',
    ]);
  });
});
