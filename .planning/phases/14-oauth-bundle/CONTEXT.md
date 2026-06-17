# Phase 14 — OAuth bundle (full Phase 08: OAuth 2.1 AS + per-user rate limits + waitlist tier UI)

## Phase goal

Make veto installable as a **claude.ai custom (remote MCP) connector**. claude.ai connectors authenticate via OAuth, not static bearer tokens; veto only does static bearers today, so it can't be added as a remote connector (confirmed earlier this session — the "Add custom connector" dialog only offers OAuth Client ID/Secret). This phase makes veto its own OAuth 2.1 Authorization Server + Resource Server, reusing magic-link as the human login step.

Scope (user chose the full Phase 08 bundle, 2026-06-17):
1. **OAuth 2.1 authorization server** on getvetoed.com.
2. **Per-user rate limits** replacing per-token (a user may now have many tokens via OAuth refresh).
3. **Waitlist / tier UI** on `/account/upgrade` (interest capture; no Stripe — HANDOFF: Aljosa chose waitlist over payment).

## Hard safety constraints

- **Additive.** The existing static bearer-token path (Claude Desktop via `mcp-remote`, Cursor, Codex CLI) MUST keep working byte-for-byte. OAuth issues the SAME `pv_`-shaped tokens into the SAME `tokens` table, so `authRequired` validates both identically.
- **Branch-first, deploy-once.** OAuth is production auth on a live multi-tenant service. The discovery metadata is only useful once the full handshake (`/register` → `/authorize` → `/token`) works end-to-end — a half-advertised AS makes claude.ai discover then fail. So this is built on `feat/oauth`, verified end-to-end (unit + a scripted full-flow smoke), and merged+deployed as ONE reviewed unit. Nothing OAuth-related ships to main until the whole flow passes.
- **assert-fomi 6/6** and all existing tests stay green throughout.
- **`src/validation/` and `src/lib/bias.ts` untouched** — OAuth is transport/auth only.

## Spec basis (MCP 2025-11-25 authorization, fetched via context7)

- MCP server MUST implement **OAuth 2.0 Protected Resource Metadata (RFC 9728)**: `GET /.well-known/oauth-protected-resource` → `{ resource, authorization_servers, scopes_supported, bearer_methods_supported }`. Used by the client for AS discovery.
- On unauthenticated `/mcp`, the **401 `WWW-Authenticate`** must carry `resource_metadata="https://getvetoed.com/.well-known/oauth-protected-resource"` (+ optional `scope`).
- AS MUST implement **OAuth 2.0 Authorization Server Metadata (RFC 8414)**: `GET /.well-known/oauth-authorization-server` → `issuer`, `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code","refresh_token"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`.
- **OAuth 2.1**: authorization code + **PKCE (S256) mandatory**; public clients (`token_endpoint_auth_method: none`).
- **Dynamic Client Registration (RFC 7591)** SHOULD be supported (claude.ai uses it): `POST /register` → `{ client_id, redirect_uris, ... }`.

## Architecture (locked with Aljosa 2026-06-17)

1. **veto is its own AS + RS** (not delegating to a third-party IdP). It already issues `pv_` tokens and has magic-link login — the OAuth `/authorize` step authenticates the human via the existing magic-link email flow, then issues an authorization code.
2. **PKCE S256 required**; no client secret (public clients). DCR open registration (store `client_id` + `redirect_uris`; validate redirect_uri exact-match at `/authorize` and `/token`).
3. **Authorization code**: short-lived (60s), single-use, bound to `client_id` + `redirect_uri` + `code_challenge` + the authenticated user, stored hashed in a new `oauth_codes` table.
4. **Access token = a `pv_` token** minted into `tokens` with the user's email + an `oauth_client_id` column, so the existing `authRequired` middleware validates OAuth-issued tokens with zero change. **Refresh tokens** stored hashed in `oauth_refresh_tokens`.
5. **Per-user rate limits** (replacing per-token): rate-limit by the token's `user_email` (or a `user_id`) so a user can't multiply their quota by minting tokens. Keep the global Serper cap. The per-token limiter stays as a fallback for legacy bearer tokens with no user binding.
6. **Waitlist/tier UI** at `GET /account/upgrade`: a static BRAND.md-styled page with a form → `POST /account/upgrade` records interest in a `waitlist` table (per-IP + per-email rate-limited, like /signup). No payment.

## Sub-phase plan (each a reviewable increment on feat/oauth)

- **14a — Storage + DCR foundation:** `oauth_clients`, `oauth_codes`, `oauth_refresh_tokens` tables; `POST /register` (DCR); `GET /.well-known/oauth-protected-resource` + `/.well-known/oauth-authorization-server`; 401 `WWW-Authenticate` gains `resource_metadata`. Additive, but metadata is harmless without the flow (clients only act on it after 401). Tests for DCR + metadata shape.
- **14b — Authorize endpoint:** `GET /authorize` (validate client_id/redirect_uri/PKCE/response_type) → magic-link login → on verify, mint a single-use auth code bound to client+challenge+user, redirect to `redirect_uri?code=...&state=...`.
- **14c — Token endpoint:** `POST /token` — `authorization_code` grant (verify code + PKCE verifier → mint `pv_` access token + refresh token) and `refresh_token` grant. RFC 6749 error responses.
- **14d — Per-user rate limits:** add `user_email`/`oauth_client_id` to `tokens`; rate-limit middleware keys on user when present, per-token otherwise.
- **14e — Waitlist/tier UI:** `/account/upgrade` page + `POST` + `waitlist` table + rate limits.
- **14f — End-to-end flow smoke + merge + deploy:** scripted full OAuth handshake (register → authorize w/ magic-link → token → call /mcp with the issued token), assert-fomi, smoke:http, then merge feat/oauth → main and deploy, verify claude.ai-shaped discovery on prod.

## Success criteria

- A scripted OAuth 2.1 + PKCE flow against the server yields a working `pv_` access token that authenticates `/mcp`.
- `/.well-known/oauth-protected-resource` + `/.well-known/oauth-authorization-server` return spec-valid metadata; unauthenticated `/mcp` 401 carries `resource_metadata`.
- Existing static bearer tokens + `mcp-remote` path unaffected (regression-tested).
- Per-user rate limits enforced; global Serper cap intact.
- `/account/upgrade` waitlist works, rate-limited, no payment.
- assert-fomi 6/6; all tests green; merged + deployed as one unit only after the e2e smoke passes.
