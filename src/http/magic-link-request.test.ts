// Phase 05a D-03-5 — Tests for POST /auth/magic-link/request.
//
// Mirrors the test layout from signup.test.ts: build a minimal Express app
// that carries the same handler logic so we don't have to spin up the full
// MCP transport. The handler body is a verbatim copy of the production
// handler in src/http/server.ts; if we extract the handler later, replace
// the inline block with an import.
//
// Coverage:
//   - Happy path: 200 + DB row created + magic-link email queued (mocked).
//   - Honeypot: `website` non-empty → 200 silently, NO DB row, NO email.
//   - Invalid email → 400 invalid_email.
//   - Per-IP cap → 429 + Retry-After + reason 'per_ip_limit_exceeded'.
//   - Per-email cap → 429 + reason 'per_email_limit_exceeded' (distinct IPs
//     each request to bypass the IP limit).
//   - Resend failure still yields 200 (no leak of delivery status).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { __resetDbForTests, getDb } from '../db/connection.js';
import { logger } from '../lib/logger.js';
import { checkAndIncrementMagicLinkIp } from '../ratelimit/magic-link-ip.js';
import {
  checkAndIncrementMagicLinkEmail,
  hashEmailForRateLimit,
} from '../ratelimit/magic-link-email.js';
import { hashIp } from '../auth/signup-requests.js';
import { issueMagicLink } from '../auth/magic-link.js';

// Mock the email sender so we don't need RESEND_API_KEY set.
const sendCalls: Array<{ to: string; url: string }> = [];
let sendResult: { ok: true; id: string } | { ok: false; error: string } = {
  ok: true,
  id: 'mock-id',
};

vi.mock('../lib/email.js', () => ({
  sendMagicLinkEmail: async (input: { to: string; url: string }) => {
    sendCalls.push(input);
    return sendResult;
  },
}));

import { sendMagicLinkEmail } from '../lib/email.js';

const DB_PATH = join(
  tmpdir(),
  `vetoed-test-magic-req-${randomBytes(6).toString('hex')}.db`
);

const SIGNUP_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIGNUP_EMAIL_MAX_LEN = 254;
const MAGIC_LINK_SUCCESS_MESSAGE = 'Check your inbox for a sign-in link.';
const MAGIC_LINK_BASE_URL = 'https://test.getvetoed.com';

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());

  app.post('/auth/magic-link/request', (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        email?: unknown;
        website?: unknown;
      };

      if (typeof body.website === 'string' && body.website.trim().length > 0) {
        logger.warn(
          { event: 'magic_link_honeypot_tripped' },
          'magic link honeypot tripped — silently dropping'
        );
        res.status(200).json({ ok: true, message: MAGIC_LINK_SUCCESS_MESSAGE });
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

      const ipSource =
        typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : 'unknown';
      const ipHash = hashIp(ipSource);
      const ipLimit = checkAndIncrementMagicLinkIp(ipHash);
      if (!ipLimit.allowed) {
        logger.warn(
          {
            event: 'magic_link_rate_limited',
            scope: 'ip',
            retry_after_sec: ipLimit.retryAfterSec,
          },
          'magic_link_rate_limited'
        );
        res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
        res.status(429).json({
          error: 'rate_limited',
          reason: 'per_ip_limit_exceeded',
          message: "Whoa — slow down. Try again in a bit.",
          retry_after_sec: ipLimit.retryAfterSec,
        });
        return;
      }

      const emailLimit = checkAndIncrementMagicLinkEmail(
        hashEmailForRateLimit(rawEmail)
      );
      if (!emailLimit.allowed) {
        logger.warn(
          {
            event: 'magic_link_rate_limited',
            scope: 'email',
            retry_after_sec: emailLimit.retryAfterSec,
          },
          'magic_link_rate_limited'
        );
        res.setHeader('Retry-After', String(emailLimit.retryAfterSec));
        res.status(429).json({
          error: 'rate_limited',
          reason: 'per_email_limit_exceeded',
          message: 'Too many sign-in requests for this email. Try again in a bit.',
          retry_after_sec: emailLimit.retryAfterSec,
        });
        return;
      }

      const issued = issueMagicLink(rawEmail);
      const url = `${MAGIC_LINK_BASE_URL}/auth/magic-link/verify?token=${encodeURIComponent(
        issued.plaintext
      )}`;

      sendMagicLinkEmail({ to: rawEmail, url })
        .then((result) => {
          if (!result.ok) {
            logger.error(
              {
                event: 'magic_link_email_failed',
                magic_link_id: issued.id,
                error: result.error,
              },
              'magic_link_email_failed'
            );
          }
        })
        .catch((err: unknown) => {
          logger.error(
            {
              event: 'magic_link_email_threw',
              magic_link_id: issued.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'magic_link_email_threw'
          );
        });

      res.status(200).json({ ok: true, message: MAGIC_LINK_SUCCESS_MESSAGE });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'magic_link_request_handler_error'
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
  sendCalls.length = 0;
  sendResult = { ok: true, id: 'mock-id' };
  const db = getDb();
  db.exec('DELETE FROM magic_link_tokens;');
  db.exec('DELETE FROM rate_limits;');
  db.exec('DELETE FROM tokens;');
});

afterAll(() => {
  cleanup();
});

describe('POST /auth/magic-link/request — happy path', () => {
  it('returns 200 + success body, creates a row, and queues the email', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/magic-link/request')
      .send({ email: 'alice@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: MAGIC_LINK_SUCCESS_MESSAGE });

    const db = getDb();
    const rows = db
      .prepare('SELECT email, email_normalized FROM magic_link_tokens')
      .all() as Array<{ email: string; email_normalized: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe('alice@example.com');

    // Fire-and-forget — wait one tick for the .then() chain.
    await new Promise((r) => setImmediate(r));
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]!.to).toBe('alice@example.com');
    expect(sendCalls[0]!.url).toContain(`${MAGIC_LINK_BASE_URL}/auth/magic-link/verify?token=`);
  });

  it('issues a NEW magic-link row on every request (no dedup)', async () => {
    const app = buildApp();
    await request(app).post('/auth/magic-link/request').send({ email: 'bob@example.com' });
    await request(app).post('/auth/magic-link/request').send({ email: 'bob@example.com' });

    const db = getDb();
    const c = db
      .prepare('SELECT COUNT(*) as c FROM magic_link_tokens')
      .get() as { c: number };
    expect(c.c).toBe(2);
  });
});

describe('POST /auth/magic-link/request — honeypot', () => {
  it('returns 200 silently and creates NO row when website honeypot is non-empty', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/magic-link/request')
      .send({ email: 'spambot@example.com', website: 'http://spam.example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: MAGIC_LINK_SUCCESS_MESSAGE });

    const db = getDb();
    const c = db
      .prepare('SELECT COUNT(*) as c FROM magic_link_tokens')
      .get() as { c: number };
    expect(c.c).toBe(0);

    // No email queued, no rate-limit increment.
    await new Promise((r) => setImmediate(r));
    expect(sendCalls).toHaveLength(0);

    const limits = db
      .prepare("SELECT COUNT(*) as c FROM rate_limits WHERE key LIKE 'magic:%'")
      .get() as { c: number };
    expect(limits.c).toBe(0);
  });
});

describe('POST /auth/magic-link/request — validation', () => {
  it('returns 400 invalid_email when missing', async () => {
    const app = buildApp();
    const res = await request(app).post('/auth/magic-link/request').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_email');
  });

  it('returns 400 invalid_email when malformed', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/magic-link/request')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_email');
  });
});

describe('POST /auth/magic-link/request — per-IP rate limit', () => {
  it('returns 429 + Retry-After on the 6th request from the same IP within 1h', async () => {
    const app = buildApp();
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/auth/magic-link/request')
        .set('X-Forwarded-For', '203.0.113.42')
        .send({ email: `u${i}@example.com` });
      expect(res.status).toBe(200);
    }

    const sixth = await request(app)
      .post('/auth/magic-link/request')
      .set('X-Forwarded-For', '203.0.113.42')
      .send({ email: 'u5@example.com' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBe('rate_limited');
    expect(sixth.body.reason).toBe('per_ip_limit_exceeded');
    expect(sixth.headers['retry-after']).toBe(String(sixth.body.retry_after_sec));
  });
});

describe('POST /auth/magic-link/request — per-email rate limit', () => {
  it('returns 429 + reason per_email_limit_exceeded when same email exhausted across distinct IPs', async () => {
    const app = buildApp();
    // 5 distinct IPs, all targeting the same email, to bypass the per-IP cap.
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/auth/magic-link/request')
        .set('X-Forwarded-For', `198.51.100.${10 + i}`)
        .send({ email: 'target@example.com' });
      expect(res.status).toBe(200);
    }

    const sixth = await request(app)
      .post('/auth/magic-link/request')
      .set('X-Forwarded-For', '198.51.100.99')
      .send({ email: 'target@example.com' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBe('rate_limited');
    expect(sixth.body.reason).toBe('per_email_limit_exceeded');
    expect(sixth.headers['retry-after']).toBe(String(sixth.body.retry_after_sec));
  });
});

describe('POST /auth/magic-link/request — resend failures', () => {
  it('still returns 200 when sendMagicLinkEmail fails (no leak of delivery state)', async () => {
    sendResult = { ok: false, error: 'simulated_resend_outage' };

    const app = buildApp();
    const res = await request(app)
      .post('/auth/magic-link/request')
      .send({ email: 'unlucky@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: MAGIC_LINK_SUCCESS_MESSAGE });

    // The row was still issued (we don't roll back on email failure).
    const db = getDb();
    const c = db
      .prepare('SELECT COUNT(*) as c FROM magic_link_tokens')
      .get() as { c: number };
    expect(c.c).toBe(1);

    await new Promise((r) => setImmediate(r));
    expect(sendCalls).toHaveLength(1);
  });
});
