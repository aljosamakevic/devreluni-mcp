// Phase 05a D-03-5 — Tests for GET /auth/magic-link/verify.
//
// Same Express-app harness pattern as magic-link-request.test.ts.
//
// Coverage:
//   - Happy path: mint magic link → GET ?token=<plaintext> → 200 + text/html
//     + bearer token visible in body + magic_link_tokens.used_at populated
//     + a new tokens row exists.
//   - Replay (same token GETted twice) → first ok, second renders the
//     'already_used' error page (still HTTP 200 because the user is reading
//     in a browser).
//   - Expired (fake timers past TTL) → 'expired' error page.
//   - Missing token query → 'missing_token' error page.
//   - Bogus token → 'not_found' error page.
//   - HTML output contains the bearer but NOT the magic-link plaintext
//     (security check — the spent magic-link plaintext is in the URL but
//     should never leak into the rendered HTML).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { __resetDbForTests, getDb } from '../db/connection.js';
import { logger } from '../lib/logger.js';
import {
  MAGIC_LINK_TTL_MS,
  issueMagicLink,
  markMagicLinkUsed,
  peekMagicLink,
} from '../auth/magic-link.js';
import { issueToken } from '../auth/tokens.js';
import {
  renderMagicLinkErrorPage,
  renderMagicLinkSuccessPage,
} from './magic-link-pages.js';

const DB_PATH = join(
  tmpdir(),
  `vetoed-test-magic-verify-${randomBytes(6).toString('hex')}.db`
);

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.get('/auth/magic-link/verify', (req: Request, res: Response) => {
    try {
      const rawToken =
        typeof req.query['token'] === 'string' ? req.query['token'] : '';

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

      if (rawToken.length === 0) {
        res.status(200).send(renderMagicLinkErrorPage('missing_token'));
        return;
      }

      const peek = peekMagicLink(rawToken);
      if (!peek) {
        logger.warn({ event: 'magic_link_verify_not_found' }, 'magic_link_verify_not_found');
        res.status(200).send(renderMagicLinkErrorPage('not_found'));
        return;
      }
      if (peek.status === 'expired') {
        res.status(200).send(renderMagicLinkErrorPage('expired'));
        return;
      }
      if (peek.status === 'used') {
        res.status(200).send(renderMagicLinkErrorPage('already_used'));
        return;
      }

      const bearer = issueToken(peek.email);
      markMagicLinkUsed(rawToken, bearer.id);
      res.status(200).send(renderMagicLinkSuccessPage(bearer.token));
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'magic_link_verify_handler_error'
      );
      if (!res.headersSent) {
        res.status(500).send('<!DOCTYPE html><html><body><h1>Something went wrong</h1></body></html>');
      }
    }
  });

  return app;
}

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

describe('GET /auth/magic-link/verify — happy path', () => {
  it('returns 200 + text/html + bearer in body, marks row used, creates bearer', async () => {
    const { plaintext } = issueMagicLink('alice@example.com');
    const app = buildApp();
    const res = await request(app)
      .get('/auth/magic-link/verify')
      .query({ token: plaintext });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toContain('no-store');

    // The success page shows the brand and the "You're in" headline.
    expect(res.text.includes("You're in")).toBe(true);

    // The new bearer token should be present in the rendered body.
    const db = getDb();
    const tokenRow = db
      .prepare('SELECT email, token_prefix FROM tokens')
      .all() as Array<{ email: string; token_prefix: string }>;
    expect(tokenRow).toHaveLength(1);
    expect(tokenRow[0]!.email).toBe('alice@example.com');
    // The 7-char prefix should appear in the body.
    expect(res.text.includes(tokenRow[0]!.token_prefix)).toBe(true);

    // The magic-link row is now marked used and bound to the bearer.
    const mlRow = db
      .prepare(
        'SELECT used_at, consumed_token_id FROM magic_link_tokens LIMIT 1'
      )
      .get() as { used_at: string | null; consumed_token_id: number | null };
    expect(mlRow.used_at).not.toBeNull();
    expect(mlRow.consumed_token_id).not.toBeNull();
  });

  it('does NOT echo the magic-link plaintext in the rendered HTML', async () => {
    const { plaintext } = issueMagicLink('bob@example.com');
    const app = buildApp();
    const res = await request(app)
      .get('/auth/magic-link/verify')
      .query({ token: plaintext });
    expect(res.status).toBe(200);
    // The magic-link plaintext must NOT appear anywhere in the rendered body —
    // only the bearer should be visible. (The plaintext is still in the URL
    // query, but useless after consumption.)
    expect(res.text.includes(plaintext)).toBe(false);
  });
});

describe('GET /auth/magic-link/verify — replay', () => {
  it('renders the already_used error page on a second click', async () => {
    const { plaintext } = issueMagicLink('carol@example.com');
    const app = buildApp();
    const first = await request(app)
      .get('/auth/magic-link/verify')
      .query({ token: plaintext });
    expect(first.status).toBe(200);

    const second = await request(app)
      .get('/auth/magic-link/verify')
      .query({ token: plaintext });
    expect(second.status).toBe(200);
    expect(second.headers['content-type']).toMatch(/text\/html/);
    expect(second.text.includes('already been used')).toBe(true);

    // Critically: no SECOND bearer was minted on the replay.
    const db = getDb();
    const c = db.prepare('SELECT COUNT(*) as c FROM tokens').get() as { c: number };
    expect(c.c).toBe(1);
  });
});

describe('GET /auth/magic-link/verify — expired', () => {
  it('renders the expired error page when the TTL has elapsed', async () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-06-14T12:00:00.000Z').getTime();
      vi.setSystemTime(start);
      const { plaintext } = issueMagicLink('dave@example.com');

      vi.setSystemTime(start + MAGIC_LINK_TTL_MS + 5000);
      const app = buildApp();
      const res = await request(app)
        .get('/auth/magic-link/verify')
        .query({ token: plaintext });
      expect(res.status).toBe(200);
      expect(res.text.includes('This link has expired')).toBe(true);

      // No bearer was minted for an expired link.
      const db = getDb();
      const c = db.prepare('SELECT COUNT(*) as c FROM tokens').get() as { c: number };
      expect(c.c).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GET /auth/magic-link/verify — missing / bogus', () => {
  it('renders missing_token error page when ?token= is absent', async () => {
    const app = buildApp();
    const res = await request(app).get('/auth/magic-link/verify');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text.includes('missing its token')).toBe(true);
  });

  it('renders not_found error page for a bogus token', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/auth/magic-link/verify')
      .query({ token: 'definitely-not-a-real-token' });
    expect(res.status).toBe(200);
    // The apostrophe gets HTML-escaped to &#39; — assert on a sub-phrase
    // that doesn't include one.
    expect(res.text.includes('find that link')).toBe(true);
  });
});
