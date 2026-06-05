// Phase 04 D-03-5 — Tests for POST /signup public endpoint.
//
// We construct a minimal Express app that mirrors what createHttpServer does
// for the /signup route (trust-proxy + json body parser + the inline handler
// pulled from server.ts). This avoids spinning up the MCP transport for a
// public-endpoint test, while still locking the actual contract:
//   - Happy path: 200 ok + DB row created.
//   - Dedup: a second request with the same email returns the same 200 body
//     but does NOT create a second pending row.
//   - Honeypot: `website` non-empty → silent 200, NO DB row created.
//   - Invalid email → 400 invalid_email.
//   - Oversize referrer → 400 invalid_referrer.
//   - 6th request from same IP within 1h → 429 + Retry-After header.
//
// To keep the test surface tight + behavior identical, the route below
// is a verbatim copy of the production handler from src/http/server.ts.
// If we extract the handler to its own module later, replace the inline
// block with an import.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { __resetDbForTests, getDb } from '../db/connection.js';
import { logger } from '../lib/logger.js';
import { checkAndIncrementSignupIp } from '../ratelimit/signup-ip.js';
import { createSignupRequest, hashIp, listSignupRequests } from '../auth/signup-requests.js';

const DB_PATH = join(tmpdir(), `vetoed-test-signup-http-${randomBytes(6).toString('hex')}.db`);

const SIGNUP_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIGNUP_EMAIL_MAX_LEN = 254;
const SIGNUP_REFERRER_MAX_LEN = 500;
const SIGNUP_SUCCESS_MESSAGE =
  "Thanks — we'll review and get back to you within a day or two.";

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());

  app.post('/signup', (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        email?: unknown;
        referrer?: unknown;
        website?: unknown;
      };

      if (typeof body.website === 'string' && body.website.trim().length > 0) {
        logger.warn(
          { event: 'signup_honeypot_tripped' },
          'signup honeypot tripped — silently dropping'
        );
        res.status(200).json({ ok: true, message: SIGNUP_SUCCESS_MESSAGE });
        return;
      }

      const rawEmail = typeof body.email === 'string' ? body.email.trim() : '';
      if (
        rawEmail.length === 0 ||
        rawEmail.length > SIGNUP_EMAIL_MAX_LEN ||
        !SIGNUP_EMAIL_REGEX.test(rawEmail)
      ) {
        res.status(400).json({
          error: 'invalid_email',
          message: 'Please enter a valid email address.',
        });
        return;
      }

      const rawReferrer = typeof body.referrer === 'string' ? body.referrer : '';
      if (rawReferrer.length > SIGNUP_REFERRER_MAX_LEN) {
        res.status(400).json({
          error: 'invalid_referrer',
          message: `Please keep the "how did you hear" note under ${SIGNUP_REFERRER_MAX_LEN} characters.`,
        });
        return;
      }

      const ipSource = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : 'unknown';
      const ipHash = hashIp(ipSource);
      const limit = checkAndIncrementSignupIp(ipHash);
      if (!limit.allowed) {
        logger.warn(
          { event: 'signup_rate_limited', retry_after_sec: limit.retryAfterSec },
          'signup_rate_limited'
        );
        res.setHeader('Retry-After', String(limit.retryAfterSec));
        res.status(429).json({
          error: 'rate_limited',
          message: "Whoa — slow down. Try again in a bit.",
          retry_after_sec: limit.retryAfterSec,
        });
        return;
      }

      createSignupRequest({
        email: rawEmail,
        referrer: rawReferrer.length > 0 ? rawReferrer : null,
        ipHash,
      });

      res.status(200).json({ ok: true, message: SIGNUP_SUCCESS_MESSAGE });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'signup_handler_error'
      );
      res.status(500).json({ error: 'internal_error' });
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
  db.exec('DELETE FROM signup_requests;');
  db.exec('DELETE FROM rate_limits;');
  db.exec('DELETE FROM tokens;');
});

afterAll(() => {
  cleanup();
});

describe('POST /signup — happy path', () => {
  it('returns 200 + success body and creates a pending row', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/signup')
      .send({ email: 'alice@example.com', referrer: 'found you on HN' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: SIGNUP_SUCCESS_MESSAGE });

    const rows = listSignupRequests({ status: 'pending' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe('alice@example.com');
    expect(rows[0]!.referrer).toBe('found you on HN');
    expect(rows[0]!.ip_hash).not.toBeNull();
  });

  it('lowercases the email on insert', async () => {
    const app = buildApp();
    await request(app).post('/signup').send({ email: 'BOB@EXAMPLE.COM' });
    const rows = listSignupRequests({ status: 'pending' });
    expect(rows[0]!.email_normalized).toBe('bob@example.com');
  });
});

describe('POST /signup — dedup idempotency', () => {
  it('returns the same 200 body for a duplicate email without creating a second row', async () => {
    const app = buildApp();
    const r1 = await request(app).post('/signup').send({ email: 'carol@example.com' });
    expect(r1.status).toBe(200);

    const r2 = await request(app).post('/signup').send({ email: 'carol@example.com' });
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual(r1.body);

    const rows = listSignupRequests({ status: 'pending' });
    expect(rows).toHaveLength(1);
  });
});

describe('POST /signup — honeypot', () => {
  it('returns 200 silently and creates NO row when website honeypot is non-empty', async () => {
    const app = buildApp();
    const res = await request(app).post('/signup').send({
      email: 'spambot@example.com',
      website: 'http://spam.example.com',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: SIGNUP_SUCCESS_MESSAGE });

    const rows = listSignupRequests({ status: 'pending' });
    expect(rows).toHaveLength(0);
  });

  it('treats a whitespace-only website value as NOT a honeypot trip', async () => {
    const app = buildApp();
    const res = await request(app).post('/signup').send({
      email: 'real@example.com',
      website: '   ',
    });
    expect(res.status).toBe(200);
    const rows = listSignupRequests({ status: 'pending' });
    expect(rows).toHaveLength(1);
  });
});

describe('POST /signup — validation', () => {
  it('returns 400 invalid_email when missing email', async () => {
    const app = buildApp();
    const res = await request(app).post('/signup').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_email');
  });

  it('returns 400 invalid_email when email is malformed', async () => {
    const app = buildApp();
    const res = await request(app).post('/signup').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_email');
  });

  it('returns 400 invalid_email when email > 254 chars', async () => {
    const app = buildApp();
    const long = 'a'.repeat(250) + '@b.cc'; // 256 chars
    const res = await request(app).post('/signup').send({ email: long });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_email');
  });

  it('returns 400 invalid_referrer when referrer > 500 chars', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/signup')
      .send({ email: 'ok@example.com', referrer: 'x'.repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_referrer');
  });

  it('accepts a referrer at exactly 500 chars', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/signup')
      .send({ email: 'ok@example.com', referrer: 'x'.repeat(500) });
    expect(res.status).toBe(200);
  });
});

describe('POST /signup — IP rate limit', () => {
  it('returns 429 + Retry-After on the 6th request from the same IP within 1h', async () => {
    const app = buildApp();

    // 5 distinct emails so dedup doesn't shadow the rate limit.
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/signup')
        .set('X-Forwarded-For', '203.0.113.42')
        .send({ email: `u${i}@example.com` });
      expect(res.status).toBe(200);
    }

    const sixth = await request(app)
      .post('/signup')
      .set('X-Forwarded-For', '203.0.113.42')
      .send({ email: 'u5@example.com' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBe('rate_limited');
    expect(typeof sixth.body.retry_after_sec).toBe('number');
    expect(sixth.body.retry_after_sec).toBeGreaterThan(0);
    expect(sixth.headers['retry-after']).toBe(String(sixth.body.retry_after_sec));
  });

  it('does NOT rate-limit a different IP', async () => {
    const app = buildApp();
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/signup')
        .set('X-Forwarded-For', '203.0.113.42')
        .send({ email: `cap${i}@example.com` });
    }
    const other = await request(app)
      .post('/signup')
      .set('X-Forwarded-For', '198.51.100.7')
      .send({ email: 'other@example.com' });
    expect(other.status).toBe(200);
  });
});
