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
import { rateLimit } from '../ratelimit/middleware.js';
import { checkAndIncrementSignupIp } from '../ratelimit/signup-ip.js';
import { createSignupRequest, hashIp } from '../auth/signup-requests.js';
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
