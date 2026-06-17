// Phase 14 — OAuth 2.1 Authorization Server HTTP surface.
//
// Endpoints (all public — they ARE the auth flow):
//   GET  /.well-known/oauth-protected-resource   RFC 9728 (AS discovery)
//   GET  /.well-known/oauth-authorization-server  RFC 8414 (AS metadata)
//   POST /register                                RFC 7591 dynamic client reg
//   GET  /authorize                               OAuth 2.1 authorize (PKCE)
//   POST /authorize/login                         email → magic link
//   GET  /oauth/callback                          magic-link verify → code → redirect
//   POST /token                                   code + refresh_token grants
//
// The human is authenticated via the existing magic-link email flow. The
// access token is a normal pv_ token minted into `tokens`, so authRequired
// validates OAuth-issued and static tokens identically.

import express, { type Express, type Request, type Response } from 'express';
import { logger } from '../lib/logger.js';
import {
  registerClient,
  getClient,
  isRegisteredRedirectUri,
  createAuthorizeRequest,
  consumeAuthorizeRequest,
  createAuthCode,
  consumeAuthCode,
  createRefreshToken,
  rotateRefreshToken,
  ACCESS_TOKEN_SCOPE,
} from '../auth/oauth.js';
import { issueMagicLink, peekMagicLink, claimMagicLink } from '../auth/magic-link.js';
import { sendMagicLinkEmail } from '../lib/email.js';
import { issueToken } from '../auth/tokens.js';
import { addToWaitlist } from '../auth/waitlist.js';
import { hashIp } from '../auth/signup-requests.js';
import { checkAndIncrementSignupIp } from '../ratelimit/signup-ip.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title} | Veto</title><style>
    body{margin:0;background:#111210;color:#F5F4F0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
    main{max-width:440px;width:100%;padding:32px}
    .wm{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;letter-spacing:-.02em;text-transform:uppercase;font-size:16px;margin-bottom:24px}
    h1{font-size:24px;line-height:1.15;margin:0 0 12px}
    p{color:rgba(245,244,240,.55);line-height:1.6;font-size:15px}
    input{width:100%;box-sizing:border-box;background:#1A1A18;border:1px solid rgba(245,244,240,.14);border-radius:2px;color:#F5F4F0;padding:12px 14px;font-size:15px;margin:8px 0 16px}
    button{background:#D4F233;color:#111210;border:0;border-radius:2px;padding:12px 20px;font-weight:600;font-size:14px;letter-spacing:.02em;cursor:pointer}
    .app{color:#D4F233}
  </style></head><body><main><div class="wm">VETO</div>${body}</main></body></html>`;
}

export function registerOAuthRoutes(app: Express, baseUrl: string): void {
  const prmUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
  // OAuth bodies are form-encoded (token, authorize/login) or JSON (register).
  const urlencoded = express.urlencoded({ extended: false });

  // ── Discovery metadata ────────────────────────────────────────────────
  // Served at BOTH the root well-known path AND the RFC 9728 §3.1
  // resource-path-suffixed variant (…/oauth-protected-resource/mcp), because
  // MCP clients differ: some follow the `resource_metadata` URL from the 401
  // header (root), others CONSTRUCT the path-suffixed URL from the resource
  // identifier. Serving both removes a discovery dead-end. Likewise the AS
  // metadata is aliased at /.well-known/openid-configuration.
  const protectedResourceMetadata = (_req: Request, res: Response): void => {
    res.json({
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl],
      scopes_supported: [ACCESS_TOKEN_SCOPE],
      bearer_methods_supported: ['header'],
    });
  };
  app.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceMetadata);

  const authorizationServerMetadata = (_req: Request, res: Response): void => {
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [ACCESS_TOKEN_SCOPE],
    });
  };
  app.get('/.well-known/oauth-authorization-server', authorizationServerMetadata);
  app.get('/.well-known/oauth-authorization-server/mcp', authorizationServerMetadata);
  app.get('/.well-known/openid-configuration', authorizationServerMetadata);

  // ── Dynamic Client Registration (RFC 7591) ────────────────────────────
  app.post('/register', express.json(), (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as { redirect_uris?: unknown; client_name?: unknown };
      const redirectUris = Array.isArray(body.redirect_uris)
        ? body.redirect_uris.filter((u): u is string => typeof u === 'string')
        : [];
      const clientName = typeof body.client_name === 'string' ? body.client_name : undefined;
      const client = registerClient({ client_name: clientName, redirect_uris: redirectUris });
      res.status(201).json({
        client_id: client.client_id,
        client_name: client.client_name ?? undefined,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      });
    } catch (err) {
      res.status(400).json({ error: 'invalid_client_metadata', error_description: err instanceof Error ? err.message : 'invalid' });
    }
  });

  // ── Authorize (OAuth 2.1 + PKCE) ──────────────────────────────────────
  app.get('/authorize', (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    const clientId = q['client_id'];
    const redirectUri = q['redirect_uri'];
    const responseType = q['response_type'];
    const codeChallenge = q['code_challenge'];
    const codeChallengeMethod = q['code_challenge_method'];
    const state = q['state'] ?? null;
    const scope = q['scope'] ?? ACCESS_TOKEN_SCOPE;

    // Validate client + redirect_uri FIRST — only redirect errors back to a
    // pre-registered redirect_uri; otherwise render an error page (OAuth 2.1).
    if (!clientId || !getClient(clientId)) {
      res.status(400).send(htmlPage('Error', '<h1>Invalid client</h1><p>This client is not registered.</p>'));
      return;
    }
    if (!redirectUri || !isRegisteredRedirectUri(clientId, redirectUri)) {
      res.status(400).send(htmlPage('Error', '<h1>Invalid redirect_uri</h1><p>The redirect URI is not registered for this client.</p>'));
      return;
    }
    const redirectError = (error: string, desc: string): void => {
      const u = new URL(redirectUri);
      u.searchParams.set('error', error);
      u.searchParams.set('error_description', desc);
      if (state) u.searchParams.set('state', state);
      res.redirect(302, u.toString());
    };
    if (responseType !== 'code') return redirectError('unsupported_response_type', 'only response_type=code is supported');
    if (codeChallengeMethod !== 'S256') return redirectError('invalid_request', 'code_challenge_method must be S256');
    if (!codeChallenge) return redirectError('invalid_request', 'code_challenge (PKCE) is required');

    // Stash the request and ask for the user's email (magic-link login).
    const areq = createAuthorizeRequest({ clientId, redirectUri, codeChallenge, scope, state });
    res.status(200).send(
      htmlPage(
        'Sign in',
        `<h1>Connect <span class="app">${getClient(clientId)?.client_name ? escapeHtml(getClient(clientId)!.client_name!) : 'an app'}</span> to Veto</h1>
         <p>Enter your email. We'll send a one-time sign-in link to authorize access.</p>
         <form method="POST" action="/authorize/login">
           <input type="hidden" name="areq" value="${escapeHtml(areq)}">
           <input type="email" name="email" placeholder="you@example.com" required autofocus>
           <button type="submit">Send sign-in link</button>
         </form>`
      )
    );
  });

  app.post('/authorize/login', urlencoded, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { areq?: string; email?: string };
    const areqId = typeof body.areq === 'string' ? body.areq : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!areqId || !EMAIL_RE.test(email) || email.length > 254) {
      res.status(400).send(htmlPage('Error', '<h1>Invalid request</h1><p>Please go back and try again.</p>'));
      return;
    }
    // Issue a magic link whose verify URL routes to the OAuth callback,
    // carrying the authorize-request id so we can mint the code afterwards.
    const link = issueMagicLink(email);
    const callbackUrl = `${baseUrl}/oauth/callback?token=${encodeURIComponent(link.plaintext)}&areq=${encodeURIComponent(areqId)}`;
    await sendMagicLinkEmail({ to: email, url: callbackUrl });
    logger.info({ event: 'oauth_authorize_login', areq_present: true }, 'oauth_authorize_login');
    res.status(200).send(htmlPage('Check your inbox', '<h1>Check your inbox</h1><p>Click the sign-in link we just sent to finish connecting. The link expires in 15 minutes.</p>'));
  });

  app.get('/oauth/callback', (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    const rawToken = q['token'] ?? '';
    const areqId = q['areq'] ?? '';

    const peek = peekMagicLink(rawToken);
    if (!peek || peek.status !== 'ok') {
      res.status(200).send(htmlPage('Link problem', '<h1>Sign-in link invalid or expired</h1><p>Request a new connection from the app.</p>'));
      return;
    }
    // Claim the magic link (one-time use) before minting anything.
    if (!claimMagicLink(rawToken)) {
      res.status(200).send(htmlPage('Link problem', '<h1>Sign-in link already used</h1><p>Request a new connection from the app.</p>'));
      return;
    }
    const areq = consumeAuthorizeRequest(areqId);
    if (!areq) {
      res.status(200).send(htmlPage('Link problem', '<h1>Authorization request expired</h1><p>Start the connection again from the app.</p>'));
      return;
    }
    // Mint the auth code bound to the client + PKCE challenge + this user.
    const code = createAuthCode({
      clientId: areq.client_id,
      redirectUri: areq.redirect_uri,
      codeChallenge: areq.code_challenge,
      email: peek.email,
      scope: areq.scope ?? ACCESS_TOKEN_SCOPE,
    });
    const u = new URL(areq.redirect_uri);
    u.searchParams.set('code', code);
    if (areq.state) u.searchParams.set('state', areq.state);
    logger.info({ event: 'oauth_code_issued', client_id: areq.client_id }, 'oauth_code_issued');
    res.redirect(302, u.toString());
  });

  // ── Token endpoint ────────────────────────────────────────────────────
  app.post('/token', urlencoded, (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const grantType = body['grant_type'];
    const tokenError = (error: string, desc: string, status = 400): void => {
      res.status(status).json({ error, error_description: desc });
    };

    if (grantType === 'authorization_code') {
      const code = body['code'] ?? '';
      const clientId = body['client_id'] ?? '';
      const redirectUri = body['redirect_uri'] ?? '';
      const codeVerifier = body['code_verifier'] ?? '';
      if (!code || !clientId || !redirectUri || !codeVerifier) {
        return tokenError('invalid_request', 'code, client_id, redirect_uri, code_verifier are required');
      }
      const result = consumeAuthCode({ code, clientId, redirectUri, codeVerifier });
      if (!result.ok) return tokenError('invalid_grant', result.reason);
      const access = issueToken(result.email);
      const refresh = createRefreshToken(clientId, result.email);
      logger.info({ event: 'oauth_token_issued', grant: 'authorization_code', bearer_prefix: access.prefix }, 'oauth_token_issued');
      res.json({ access_token: access.token, token_type: 'Bearer', scope: result.scope, refresh_token: refresh });
      return;
    }

    if (grantType === 'refresh_token') {
      const refreshToken = body['refresh_token'] ?? '';
      const clientId = body['client_id'] ?? '';
      if (!refreshToken || !clientId) return tokenError('invalid_request', 'refresh_token and client_id are required');
      const result = rotateRefreshToken(refreshToken, clientId);
      if (!result.ok) return tokenError('invalid_grant', result.reason);
      const access = issueToken(result.email);
      const refresh = createRefreshToken(clientId, result.email);
      logger.info({ event: 'oauth_token_issued', grant: 'refresh_token', bearer_prefix: access.prefix }, 'oauth_token_issued');
      res.json({ access_token: access.token, token_type: 'Bearer', scope: ACCESS_TOKEN_SCOPE, refresh_token: refresh });
      return;
    }

    tokenError('unsupported_grant_type', `grant_type "${grantType ?? ''}" is not supported`);
  });

  // ── Waitlist / tier interest (Phase 14e — no payment) ─────────────────
  app.get('/account/upgrade', (_req: Request, res: Response) => {
    res.status(200).send(
      htmlPage(
        'Upgrade',
        `<h1>Want a higher limit?</h1>
         <p>The free tier is 400 tool calls/day. Higher tiers are coming. Leave your email and we'll reach out when they're ready.</p>
         <form method="POST" action="/account/upgrade">
           <input type="email" name="email" placeholder="you@example.com" required autofocus>
           <input type="text" name="tier" placeholder="Tier you'd want (optional)">
           <input type="text" name="note" placeholder="What would you use the extra capacity for? (optional)">
           <button type="submit">Join the waitlist</button>
         </form>`
      )
    );
  });

  app.post('/account/upgrade', urlencoded, (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { email?: string; tier?: string; note?: string };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!EMAIL_RE.test(email) || email.length > 254) {
      res.status(400).send(htmlPage('Error', '<h1>Invalid email</h1><p>Please go back and enter a valid email.</p>'));
      return;
    }
    // Per-IP cap (reuses the signup limiter). Always render the same success
    // page regardless of dedup/limit so we don't leak whether an email exists.
    const ipHash = hashIp(req.ip ?? 'unknown');
    const ipCheck = checkAndIncrementSignupIp(ipHash);
    if (ipCheck.allowed) {
      try {
        addToWaitlist({ email, tier: body.tier ?? null, note: body.note ?? null, ipHash });
      } catch {
        // best-effort; never surface internals on this public form.
      }
    }
    res.status(200).send(htmlPage('Thanks', "<h1>You're on the list</h1><p>Thanks. We'll email you when higher tiers open up.</p>"));
  });

  void prmUrl; // referenced by authRequired's WWW-Authenticate (see middleware).
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
