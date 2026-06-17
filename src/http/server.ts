// SDK verified: @modelcontextprotocol/sdk@1.29.0
// Entry points used:
//   '@modelcontextprotocol/sdk/server/streamableHttp.js' -> StreamableHTTPServerTransport (Node)
//   '@modelcontextprotocol/sdk/server/express.js'        -> createMcpExpressApp helper (gives DNS-rebind protection)
// Mount pattern source: .planning/phases/03-multitenant-https/T00-spike.md
//                       crib reference: node_modules/@modelcontextprotocol/sdk/dist/esm/examples/server/jsonResponseStreamableHttp.js
// Phase 03 T01 — Express HTTP wrapper that mounts the same McpServer instance used by stdio.

import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { authRequired } from '../auth/middleware.js';
import { adminAuthRequired } from '../auth/admin-middleware.js';
import { registerAdminApi } from './admin-api.js';
import { registerOAuthRoutes } from './oauth-routes.js';
import { rateLimit } from '../ratelimit/middleware.js';
import { checkAndIncrementSignupIp } from '../ratelimit/signup-ip.js';
import { checkAndIncrementMagicLinkIp } from '../ratelimit/magic-link-ip.js';
import {
  checkAndIncrementMagicLinkEmail,
  hashEmailForRateLimit,
} from '../ratelimit/magic-link-email.js';
import { createSignupRequest, hashIp } from '../auth/signup-requests.js';
import {
  issueMagicLink,
  claimMagicLink,
  recordConsumedToken,
  peekMagicLink,
} from '../auth/magic-link.js';
import { issueToken } from '../auth/tokens.js';
import { sendMagicLinkEmail } from '../lib/email.js';
import {
  renderMagicLinkErrorPage,
  renderMagicLinkSuccessPage,
} from './magic-link-pages.js';
import { usageLogHook } from './usage-logger.js';
import { logger, getLastErrorAt } from '../lib/logger.js';
import { cacheStats } from '../lib/cache.js';
import { getDb } from '../db/connection.js';
import '../auth/types.js'; // side-effect: declaration merge for req.tokenId.

// Phase 04 D-03-5 — RFC-5322-lite email regex shared with the admin API.
// Loose: anything@anything.anything with no whitespace. We're catching
// obviously-broken input, not enforcing a strict spec.
const SIGNUP_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIGNUP_EMAIL_MAX_LEN = 254;
const SIGNUP_REFERRER_MAX_LEN = 500;
const SIGNUP_SUCCESS_MESSAGE =
  "Thanks — we'll review and get back to you within a day or two.";

// Phase 05a D-03-5 — Magic-link request endpoint config.
// Same email validation rules as /signup so a user who passes the magic-link
// form can also pass the legacy /signup form. BASE_URL controls the host
// portion of the verify URL embedded in the email — set in fly.toml [env]
// (not a secret), defaults to the production host so local dev still works.
const MAGIC_LINK_SUCCESS_MESSAGE = 'Check your inbox for a sign-in link.';
const MAGIC_LINK_BASE_URL = process.env['BASE_URL'] ?? 'https://getvetoed.com';

// Resolve package version once at module load — health endpoint reports it.
const PACKAGE_VERSION: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // build/http/server.js → ../../package.json ; src/http/server.ts → ../../package.json
    const pkgPath = join(here, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export interface HttpServerHandle {
  app: Express;
  listen: (port: number) => HttpServer;
}

/**
 * Build an Express app that serves the MCP Streamable-HTTP transport.
 *
 * `getServer` is a factory — called ONCE per initialize request to produce a fresh
 * McpServer bound to that session's transport. A single shared McpServer cannot
 * service multiple sessions: the SDK Server's `_transport` field is sticky after the
 * first `connect()`, and a second `connect()` throws
 *   "Already connected to a transport. Call close() before connecting to a new transport,
 *    or use a separate Protocol instance per connection."
 * (See D-03-7 in .planning/phases/03-multitenant-https/deferred-items.md.)
 *
 * Mirrors the SDK example at
 *   node_modules/@modelcontextprotocol/sdk/dist/esm/examples/server/jsonResponseStreamableHttp.js:8-92
 * (`const getServer = () => { ... }; const server = getServer(); await server.connect(transport);`).
 */
export function createHttpServer(getServer: () => McpServer): HttpServerHandle {
  // host '0.0.0.0' for Fly.io — containers can't bind 127.0.0.1 and serve external traffic.
  // createMcpExpressApp already wires express.json() and (for localhost hosts) DNS-rebind protection.
  const app = createMcpExpressApp({ host: '0.0.0.0' });
  app.disable('x-powered-by');

  // Phase 04 D-03-5: Fly's proxy puts the original client IP in X-Forwarded-For.
  // trust proxy = 1 tells Express to honor exactly one upstream hop, so req.ip
  // returns the real client IP (used to hash for the per-IP signup rate limit
  // in /signup). Set to 1 (not true) so the rest of the chain is still
  // treated as untrusted — limits header-spoofing surface.
  app.set('trust proxy', 1);

  // Phase 14 — OAuth 2.1 AS endpoints (discovery metadata, DCR, authorize,
  // callback, token). Public (they ARE the auth flow); mounted before the
  // bearer-gated /mcp. Additive — static bearer tokens are unaffected.
  registerOAuthRoutes(app, MAGIC_LINK_BASE_URL);

  // In-memory map keyed by mcp-session-id header. Stateful mode.
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // GET /health — Fly healthcheck endpoint. Always 200; subsystem failures surface in
  // the body's `status` field ("degraded") rather than as a non-2xx (per PLAN T03 design).
  // T22 enriches with three subsystem fields:
  //   - db_ok: SELECT 1 against getDb(); false if it throws.
  //   - last_error_at: ring-buffer (cap 1) populated by logger.error fires; null on boot.
  //   - cache_hit_rate: cacheStats() if exported by src/lib/cache.ts; null otherwise.
  //     Phase 03 deferred per D-03-1 (PLAN line 716) — cache module currently has no
  //     hit/miss counters; Phase 04 candidate. Field returns null until instrumented.
  // HTTP status stays 200 even when degraded so Fly healthcheck passes; degradation
  // is signalled via `status: "degraded"` in the body.
  app.get('/health', (_req: Request, res: Response) => {
    let dbOk = false;
    try {
      const row = getDb().prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined;
      dbOk = row?.ok === 1;
    } catch {
      dbOk = false;
    }

    // D-03-1 (resolved): cacheStats() returns live hit/miss counters from
    // src/lib/cache.ts. hit_rate is null until the first cacheGet invocation
    // (distinguishes "0/0 unknown" from "0/N legit-zero").
    const cacheHitRate: number | null = cacheStats().hit_rate;

    const lastErrorAt = getLastErrorAt();

    const degraded = !dbOk;
    const status = degraded ? 'degraded' : 'ok';

    res.status(200).json({
      status,
      version: PACKAGE_VERSION,
      uptime_s: Math.floor(process.uptime()),
      db_ok: dbOk,
      last_error_at: lastErrorAt,
      cache_hit_rate: cacheHitRate,
      transport: 'http',
      checked_at: new Date().toISOString(),
    });
  });

  // Phase 04 D-03-5 — Public self-serve access-request endpoint.
  //
  // PUBLIC: NO authRequired/rateLimit/usageLogHook in the chain. This is
  // the third (and only new) public route after /health and / (static).
  //
  // Contract (from CONTEXT.md decision 4 follow-up):
  //   - Honeypot input named `website`: if non-empty, log a warn and return
  //     200 success silently. Bots scraping the form often fill every input.
  //   - Email RFC-5322-lite + ≤254 chars. Invalid → 400 invalid_email.
  //   - Referrer optional, ≤500 chars. Over → 400 invalid_referrer.
  //   - Per-IP rate limit 5/hour (hashed IP, signup:ip:<sha256> key in
  //     rate_limits). Cap → 429 + Retry-After.
  //   - createSignupRequest handles dedup; we always return the same
  //     friendly success body so we never leak "this email already exists".
  app.post('/signup', (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        email?: unknown;
        referrer?: unknown;
        website?: unknown;
      };

      // Honeypot: silently drop with 200 success. Bots fill every input;
      // a hidden `website` input that's non-empty is a strong signal.
      // We do NOT touch the rate-limit counter or the DB — the response
      // looks identical to a successful submission so the bot can't
      // distinguish honeypot-trip from real success.
      if (typeof body.website === 'string' && body.website.trim().length > 0) {
        logger.warn(
          { event: 'signup_honeypot_tripped' },
          'signup honeypot tripped — silently dropping'
        );
        res.status(200).json({ ok: true, message: SIGNUP_SUCCESS_MESSAGE });
        return;
      }

      const rawEmail = typeof body.email === 'string' ? body.email.trim() : '';
      if (rawEmail.length === 0 || rawEmail.length > SIGNUP_EMAIL_MAX_LEN || !SIGNUP_EMAIL_REGEX.test(rawEmail)) {
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

      // Per-IP rate limit. req.ip honors trust-proxy=1, so on Fly this is
      // the original X-Forwarded-For client IP. Local dev returns 127.0.0.1.
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

      // createSignupRequest handles dedup against pending/approved rows.
      // We always return the same friendly success body regardless of
      // dedup so the public surface never leaks "this email is in the system".
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

  // Phase 05a D-03-5 — Public magic-link request endpoint.
  //
  // PUBLIC: NO authRequired/rateLimit/usageLogHook in the chain. Coexists
  // with POST /signup (Phase 04 manual-approval path stays for backward
  // compat / direct API callers). Both endpoints are mounted BEFORE the
  // express.static fallthrough to avoid the static middleware shadowing them.
  //
  // Contract:
  //   - Honeypot input named `website`: non-empty → 200 success silently,
  //     no DB write, no rate-limit increment, no email sent.
  //   - Email RFC-5322-lite + ≤254 chars. Invalid → 400 invalid_email.
  //   - Per-IP rate limit (magic:ip:<sha256> key) 5/hour. Cap → 429.
  //   - Per-email rate limit (magic:email:<sha256-of-lowercased-email>)
  //     5/hour. Cap → 429. Check AFTER per-IP so spammers can't enumerate
  //     "email exists" via 429-vs-200 differentiation (the per-IP cap
  //     catches them first).
  //   - issueMagicLink → embed the plaintext in the verify URL.
  //   - sendMagicLinkEmail fire-and-forget: we don't await so a slow Resend
  //     can't tie up the request. We always return the same
  //     MAGIC_LINK_SUCCESS_MESSAGE regardless of email delivery outcome to
  //     avoid leaking whether the address exists or Resend is up.
  app.post('/auth/magic-link/request', (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        email?: unknown;
        website?: unknown;
      };

      // Honeypot: silently drop. Same shape as /signup so bots see identical
      // response patterns across both endpoints.
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

      // Per-IP rate limit (first — cheaper to hash one IP than one email,
      // and the IP gate is the primary spam dampener).
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

      // Per-email rate limit. Backstop for distributed spam targeting one inbox.
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
          message: "Too many sign-in requests for this email. Try again in a bit.",
          retry_after_sec: emailLimit.retryAfterSec,
        });
        return;
      }

      const issued = issueMagicLink(rawEmail);
      const url = `${MAGIC_LINK_BASE_URL}/auth/magic-link/verify?token=${encodeURIComponent(
        issued.plaintext
      )}`;

      // Fire-and-forget so a slow Resend can't delay the response. Log on
      // failure so operators can spot delivery problems via the
      // 'magic_link_email_failed' event in pino output.
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

  // Phase 05a D-03-5 — Public magic-link verify endpoint.
  //
  // PUBLIC: NO authRequired/rateLimit/usageLogHook. Returns
  // Content-Type: text/html (server-side rendered, no template engine).
  //
  // Flow (peek/mark split — see src/auth/magic-link.ts header for rationale):
  //   1. Read token from ?token=. Missing → error page 'missing_token'.
  //   2. peekMagicLink (read-only) → null | { email, status }.
  //      - null → error page 'not_found'.
  //      - status='expired' → error page 'expired'.
  //      - status='used' → error page 'already_used'.
  //   3. issueToken(email) → new bearer (plaintext returned once).
  //   4. markMagicLinkUsed(plaintext, bearer.id) → binds the bearer back
  //      to the magic link row. Returns false on a race-loss (someone
  //      else consumed the link between peek and mark). We accept the
  //      duplicate bearer issuance — the new bearer is still valid for
  //      this user (multi-device contract, no revocation on race).
  //   5. Render the success HTML with the bearer + Claude Desktop config
  //      snippet. The bearer plaintext appears in the HTML body BUT NOT
  //      in the URL — the URL still contains the (now-spent) magic link
  //      plaintext, which is useless after consumption.
  //
  // We always return HTTP 200 + text/html — even for error pages — because
  // the user is reading the page in a browser. A 4xx would render the
  // browser's error chrome instead.
  app.get('/auth/magic-link/verify', (req: Request, res: Response) => {
    try {
      const rawToken = typeof req.query['token'] === 'string' ? req.query['token'] : '';

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // Defense-in-depth: never let an upstream cache memoize a consumed-link page.
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

      if (rawToken.length === 0) {
        res.status(200).send(renderMagicLinkErrorPage('missing_token'));
        return;
      }

      // S-M2 — this endpoint is triggerable by anyone holding the link (mail-
      // security prefetchers, shared screenshots), so it must not log the
      // email (PII) on its unauthenticated paths.
      const peek = peekMagicLink(rawToken);
      if (!peek) {
        logger.warn({ event: 'magic_link_verify_not_found' }, 'magic_link_verify_not_found');
        res.status(200).send(renderMagicLinkErrorPage('not_found'));
        return;
      }
      if (peek.status === 'expired') {
        logger.warn({ event: 'magic_link_verify_expired' }, 'magic_link_verify_expired');
        res.status(200).send(renderMagicLinkErrorPage('expired'));
        return;
      }
      if (peek.status === 'used') {
        logger.warn({ event: 'magic_link_verify_replay' }, 'magic_link_verify_replay');
        res.status(200).send(renderMagicLinkErrorPage('already_used'));
        return;
      }

      // S-M1 — CLAIM the link atomically BEFORE minting. Only the caller that
      // flips used_at IS NULL → now wins; everyone else gets already_used and
      // mints nothing. This closes the "two valid tokens from one link" race
      // (link prefetchers, double-clicks).
      const claimed = claimMagicLink(rawToken);
      if (!claimed) {
        logger.warn({ event: 'magic_link_verify_race_loss' }, 'magic_link_verify_race_loss');
        res.status(200).send(renderMagicLinkErrorPage('already_used'));
        return;
      }

      // Won the claim → mint exactly one bearer and bind it for audit.
      const bearer = issueToken(peek.email);
      recordConsumedToken(rawToken, bearer.id);
      logger.info(
        { event: 'magic_link_verify_success', bearer_prefix: bearer.prefix },
        'magic_link_verify_success'
      );

      res.status(200).send(renderMagicLinkSuccessPage(bearer.token));
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'magic_link_verify_handler_error'
      );
      // Last-resort: a generic 500 HTML page rather than JSON, since the
      // browser is already expecting HTML on this route.
      if (!res.headersSent) {
        res.status(500).send('<!DOCTYPE html><html><body><h1>Something went wrong</h1></body></html>');
      }
    }
  });

  // T07 — authRequired guards POST /mcp ONLY (not /health, not /admin, not /).
  // T13 — rateLimit runs AFTER authRequired (needs req.tokenId) and BEFORE the
  //        transport handler. Per-token cap responds 429 + Retry-After here;
  //        the global Serper cap lives inside src/lib/serper.ts (graceful
  //        degradation, no 429).
  // T14 — usageLogHook wraps res.write/res.end so we can record one usage_log
  //        row per tools/call request after the transport finishes. It runs
  //        AFTER rateLimit so 429 responses are skipped (T13 already recorded
  //        the rate_limited audit row — never double-count).
  app.post('/mcp', authRequired, rateLimit, usageLogHook, async (req: Request, res: Response) => {
    try {
      const sessionId =
        typeof req.headers['mcp-session-id'] === 'string'
          ? req.headers['mcp-session-id']
          : undefined;

      if (sessionId && transports[sessionId]) {
        await transports[sessionId].handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && isInitializeRequest(req.body)) {
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          // CRITICAL: write transports[sid] = transport inside onsessioninitialized,
          // NOT inline before the session is established. Race-condition gotcha flagged
          // in jsonResponseStreamableHttp.js:84-89 and in T00-spike.md follow-up #3.
          onsessioninitialized: (id: string) => {
            transports[id] = transport;
          },
        });

        // Fresh McpServer per session — see D-03-7. Reusing a single instance
        // throws "Already connected to a transport" on the SECOND initialize.
        const session = getServer();
        await session.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
    } catch (error) {
      logger.error({ err: error instanceof Error ? error.message : String(error) }, 'mcp_request_error');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  // GET /mcp is reserved for the server-initiated SSE stream per spec; Phase 03 has no
  // server-initiated push need, so return 405 with Allow: POST per the SDK example.
  app.get('/mcp', (_req: Request, res: Response) => {
    res.status(405).set('Allow', 'POST').send('Method Not Allowed');
  });

  // T27 — Admin dashboard. Path-prefix middleware gates everything under /admin
  // (HTML + API). adminAuthRequired fails closed with HTTP 500 when
  // ADMIN_PASSWORD is unset/empty/short — never silently allows.
  // Mount order under /admin:
  //   1. adminAuthRequired (this line)
  //   2. /admin/api/* routes (T28, via registerAdminApi)
  //   3. express.static('public/admin') for the HTML
  // The API routes register AFTER the gate so they inherit auth. Static
  // serve mounts LAST so explicit API routes win on /admin/api/* paths.
  app.use('/admin', adminAuthRequired);
  registerAdminApi(app, getDb());
  app.use('/admin', express.static('public/admin'));

  // Route ordering (mount order matters — first match wins):
  //   GET /health        — T03 (Stream A)
  //   POST /mcp          — T01 + T07 + T13 + T14 (auth/rate-limit/usage-log gated)
  //   GET /mcp           — 405 method-not-allowed
  //   GET /admin/*       — T27/T28 (Stream F), basic-auth gated
  //   GET /              — T26 (Stream F), express.static('public')
  // Static mount MUST be wired LAST so it doesn't shadow named routes
  // (notably /health and /mcp). express.static('public') serves public/index.html
  // for GET / and any other file under public/ (e.g. public/favicon.ico).
  app.use(express.static('public'));

  return {
    app,
    listen: (port: number): HttpServer => {
      return app.listen(port);
    },
  };
}

// Re-export express helpers downstream tasks may need.
export { express };
