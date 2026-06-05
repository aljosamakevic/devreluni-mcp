// Phase 04 D-03-5 — Unit tests for src/auth/signup-requests.ts.
//
// Locks the CRUD contracts:
//   - Insert / dedup behavior (pending dedupes, approved dedupes, denied re-allows)
//   - Approve issues a token + binds token_id + flips status
//   - Deny flips status without issuing a token
//   - Double-approve on the same id returns null (idempotency guard)
//   - listSignupRequests + getSignupRequest shape

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetDbForTests, getDb } from '../db/connection.js';
import {
  approveSignupRequest,
  createSignupRequest,
  denySignupRequest,
  getSignupRequest,
  hashIp,
  listSignupRequests,
} from './signup-requests.js';

const DB_PATH = join(tmpdir(), `vetoed-test-signup-${randomBytes(6).toString('hex')}.db`);

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
  db.exec('DELETE FROM signup_requests;');
  db.exec('DELETE FROM tokens;');
});

afterAll(() => {
  cleanup();
});

describe('createSignupRequest', () => {
  it('inserts a new pending row and returns deduped: false', () => {
    const r = createSignupRequest({ email: 'alice@example.com' });
    expect(r.deduped).toBe(false);
    expect(typeof r.id).toBe('number');

    const row = getSignupRequest(r.id)!;
    expect(row.email).toBe('alice@example.com');
    expect(row.email_normalized).toBe('alice@example.com');
    expect(row.status).toBe('pending');
    expect(row.referrer).toBeNull();
    expect(row.ip_hash).toBeNull();
    expect(row.token_id).toBeNull();
    expect(row.status_changed_at).toBeNull();
  });

  it('lowercases + trims email on insert', () => {
    const r = createSignupRequest({ email: '  Alice@Example.COM  ' });
    const row = getSignupRequest(r.id)!;
    expect(row.email).toBe('alice@example.com');
    expect(row.email_normalized).toBe('alice@example.com');
  });

  it('persists referrer and ip_hash when supplied', () => {
    const r = createSignupRequest({
      email: 'bob@example.com',
      referrer: 'found you on HN',
      ipHash: hashIp('1.2.3.4'),
    });
    const row = getSignupRequest(r.id)!;
    expect(row.referrer).toBe('found you on HN');
    expect(row.ip_hash).toBe(hashIp('1.2.3.4'));
    // ip_hash is a sha256 hex digest — never the raw IP.
    expect(row.ip_hash).not.toBe('1.2.3.4');
    expect(row.ip_hash!.length).toBe(64);
  });

  it('dedupes when a pending row already exists for the same email', () => {
    const first = createSignupRequest({ email: 'carol@example.com' });
    const second = createSignupRequest({ email: 'carol@example.com' });
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);

    // Still only one row in the DB.
    expect(listSignupRequests({ status: 'pending' })).toHaveLength(1);
  });

  it('dedupes case-insensitively', () => {
    const first = createSignupRequest({ email: 'dave@example.com' });
    const second = createSignupRequest({ email: 'DAVE@EXAMPLE.COM' });
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('dedupes when a row already exists with status=approved', () => {
    const first = createSignupRequest({ email: 'erin@example.com' });
    const approved = approveSignupRequest(first.id, null);
    expect(approved).not.toBeNull();

    const second = createSignupRequest({ email: 'erin@example.com' });
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('allows a NEW request after a denial (denied → re-allowed)', () => {
    const first = createSignupRequest({ email: 'frank@example.com' });
    const denied = denySignupRequest(first.id);
    expect(denied).not.toBeNull();

    const second = createSignupRequest({ email: 'frank@example.com' });
    expect(second.deduped).toBe(false);
    expect(second.id).not.toBe(first.id);

    // Now we have a denied row + a pending row.
    expect(listSignupRequests({ status: 'denied' })).toHaveLength(1);
    expect(listSignupRequests({ status: 'pending' })).toHaveLength(1);
  });

  it('throws when email normalizes to empty', () => {
    expect(() => createSignupRequest({ email: '   ' })).toThrow();
  });
});

describe('listSignupRequests', () => {
  it('returns pending rows ordered DESC by created_at by default', async () => {
    const a = createSignupRequest({ email: 'a@example.com' });
    // Force a 2ms gap so ISO timestamps differ.
    await new Promise((r) => setTimeout(r, 5));
    const b = createSignupRequest({ email: 'b@example.com' });
    await new Promise((r) => setTimeout(r, 5));
    const c = createSignupRequest({ email: 'c@example.com' });

    const rows = listSignupRequests();
    expect(rows.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
  });

  it('filters by status', () => {
    const a = createSignupRequest({ email: 'a@example.com' });
    const b = createSignupRequest({ email: 'b@example.com' });
    const c = createSignupRequest({ email: 'c@example.com' });
    approveSignupRequest(a.id, null);
    denySignupRequest(b.id);

    expect(listSignupRequests({ status: 'pending' }).map((r) => r.id)).toEqual([c.id]);
    expect(listSignupRequests({ status: 'approved' }).map((r) => r.id)).toEqual([a.id]);
    expect(listSignupRequests({ status: 'denied' }).map((r) => r.id)).toEqual([b.id]);
  });

  it('honors the limit param', () => {
    for (let i = 0; i < 10; i++) createSignupRequest({ email: `user${i}@example.com` });
    expect(listSignupRequests({ limit: 3 })).toHaveLength(3);
  });
});

describe('approveSignupRequest', () => {
  it('issues a token, returns plaintext + prefix exactly once, and updates the row', () => {
    const { id } = createSignupRequest({ email: 'grace@example.com' });
    const result = approveSignupRequest(id, 'Welcome aboard, Grace!');
    expect(result).not.toBeNull();
    const { request, tokenPlaintext, tokenPrefix } = result!;

    expect(tokenPlaintext.startsWith('pv_')).toBe(true);
    expect(tokenPrefix).toBe(tokenPlaintext.slice(0, 7));
    expect(tokenPrefix.length).toBe(7);

    expect(request.status).toBe('approved');
    expect(request.admin_note).toBe('Welcome aboard, Grace!');
    expect(request.token_id).not.toBeNull();
    expect(typeof request.status_changed_at).toBe('string');

    // The token was minted in the tokens table, bound to the same email.
    const db = getDb();
    const tokenRow = db
      .prepare('SELECT email, status FROM tokens WHERE id = ?')
      .get(request.token_id) as { email: string; status: string };
    expect(tokenRow.email).toBe('grace@example.com');
    expect(tokenRow.status).toBe('active');
  });

  it('accepts a null admin_note', () => {
    const { id } = createSignupRequest({ email: 'henry@example.com' });
    const result = approveSignupRequest(id, null);
    expect(result).not.toBeNull();
    expect(result!.request.admin_note).toBeNull();
  });

  it('returns null when the id does not exist', () => {
    expect(approveSignupRequest(99999, null)).toBeNull();
  });

  it('returns null on double-approve (idempotency guard)', () => {
    const { id } = createSignupRequest({ email: 'iris@example.com' });
    expect(approveSignupRequest(id, null)).not.toBeNull();
    expect(approveSignupRequest(id, null)).toBeNull();
  });

  it('returns null when the request was already denied', () => {
    const { id } = createSignupRequest({ email: 'jane@example.com' });
    expect(denySignupRequest(id)).not.toBeNull();
    expect(approveSignupRequest(id, null)).toBeNull();
  });
});

describe('denySignupRequest', () => {
  it('flips status to denied without issuing a token', () => {
    const { id } = createSignupRequest({ email: 'kate@example.com' });
    const result = denySignupRequest(id);
    expect(result).not.toBeNull();
    expect(result!.request.status).toBe('denied');
    expect(result!.request.token_id).toBeNull();
    expect(typeof result!.request.status_changed_at).toBe('string');

    // No token row created.
    const db = getDb();
    const tokens = db.prepare('SELECT COUNT(*) as c FROM tokens').get() as { c: number };
    expect(tokens.c).toBe(0);
  });

  it('returns null when the id does not exist', () => {
    expect(denySignupRequest(99999)).toBeNull();
  });

  it('returns null on double-deny', () => {
    const { id } = createSignupRequest({ email: 'leo@example.com' });
    expect(denySignupRequest(id)).not.toBeNull();
    expect(denySignupRequest(id)).toBeNull();
  });

  it('returns null when already approved', () => {
    const { id } = createSignupRequest({ email: 'mia@example.com' });
    expect(approveSignupRequest(id, null)).not.toBeNull();
    expect(denySignupRequest(id)).toBeNull();
  });
});

describe('hashIp', () => {
  it('returns a 64-char sha256 hex digest', () => {
    const h = hashIp('203.0.113.42');
    expect(h.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(h)).toBe(true);
  });

  it('is deterministic for the same input', () => {
    expect(hashIp('1.2.3.4')).toBe(hashIp('1.2.3.4'));
  });

  it('differs across different IPs', () => {
    expect(hashIp('1.2.3.4')).not.toBe(hashIp('1.2.3.5'));
  });
});
