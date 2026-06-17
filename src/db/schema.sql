-- Phase 03 T05 — SQLite schema applied on boot via IF NOT EXISTS (idempotent).
-- See CONTEXT.md decision 7 + PLAN.md T05.

CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,   -- sha256(plaintext token); plaintext is never stored.
  token_prefix TEXT NOT NULL,         -- first 7 chars of plaintext ('pv_xxxxx') — grep-friendly.
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,           -- ISO timestamp UTC.
  last_used_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked'))
);

CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id INTEGER NOT NULL REFERENCES tokens(id),
  tool_name TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,               -- 'ok' | 'error' | 'rate_limited'
  created_at TEXT NOT NULL            -- ISO timestamp UTC.
);

CREATE INDEX IF NOT EXISTS idx_usage_log_token_created
  ON usage_log(token_id, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,               -- e.g. 'global:serper:YYYY-MM-DD'
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL          -- ISO timestamp UTC midnight.
);

-- Phase 04 — Self-serve signup queue (D-03-5). One row per access request
-- submitted via the public POST /signup endpoint. The admin dashboard reads
-- the pending subset, approves (which issues a token + emails it via Resend)
-- or denies (silent — no email). created_at/status_changed_at are ISO UTC.
-- email + email_normalized are both lowercased on insert; we keep both columns
-- for clarity even though they're identical today (a future case-insensitive
-- normalize step beyond lowercase would diverge them).
CREATE TABLE IF NOT EXISTS signup_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,                  -- lowercased on insert
  email_normalized TEXT NOT NULL,        -- same as email but explicit for clarity
  referrer TEXT,                          -- optional "how did you hear" free text, ≤500 chars
  ip_hash TEXT,                          -- sha256 of source IP at submission time
  created_at TEXT NOT NULL,              -- ISO timestamp UTC
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied')),
  status_changed_at TEXT,                -- ISO timestamp UTC when admin acted
  admin_note TEXT,                       -- optional note included in approval email
  token_id INTEGER REFERENCES tokens(id) -- set when approved
);

CREATE INDEX IF NOT EXISTS idx_signup_requests_status ON signup_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_signup_requests_email ON signup_requests(email_normalized);

-- Phase 05a — Magic link auth. One row per magic link issued. Plaintext is never
-- stored; we keep sha256(plaintext) and validate by hashing the URL query param
-- and looking up by hash. used_at marks consumption (one-time-use enforcement);
-- expires_at is 15 minutes after created_at (UTC ISO).
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,        -- lowercased; index target
  token_hash TEXT NOT NULL UNIQUE,        -- sha256 of plaintext
  created_at TEXT NOT NULL,               -- ISO UTC
  expires_at TEXT NOT NULL,               -- ISO UTC (created_at + 15 min)
  used_at TEXT,                            -- ISO UTC when consumed; NULL means unused
  consumed_token_id INTEGER REFERENCES tokens(id)  -- bearer token issued on consumption
);

CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_email
  ON magic_link_tokens(email_normalized, created_at);
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_expires
  ON magic_link_tokens(expires_at);

-- Phase 14 — OAuth 2.1 Authorization Server. veto is its own AS + Resource
-- Server: OAuth-issued access tokens are minted into `tokens` (same pv_ shape,
-- same authRequired validation), so these tables hold only OAuth-specific
-- state (registered clients, short-lived auth codes, refresh tokens).

-- Dynamically-registered clients (RFC 7591). Public clients (PKCE, no secret).
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,             -- opaque, server-generated
  client_name TEXT,                        -- from registration metadata (display only)
  redirect_uris TEXT NOT NULL,             -- JSON array of exact-match redirect URIs
  created_at TEXT NOT NULL                 -- ISO UTC
);

-- Authorization codes (OAuth 2.1, single-use, ~60s). Plaintext never stored.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,              -- sha256(plaintext code)
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  redirect_uri TEXT NOT NULL,              -- must match the one used at /authorize
  code_challenge TEXT NOT NULL,            -- PKCE S256 challenge
  email TEXT NOT NULL,                     -- the human authenticated via magic-link
  scope TEXT,                              -- granted scope (space-delimited)
  created_at TEXT NOT NULL,                -- ISO UTC
  expires_at TEXT NOT NULL,                -- ISO UTC (created_at + 60s)
  consumed_at TEXT                         -- ISO UTC when redeemed; NULL = unused
);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_codes(expires_at);

-- Refresh tokens (hashed). Bound to the issued access token's user + client.
CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,             -- sha256(plaintext refresh token)
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,                -- ISO UTC
  revoked_at TEXT                          -- ISO UTC when rotated/revoked; NULL = active
);

-- Phase 14 — waitlist (tier interest capture, no payment).
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  tier TEXT,                               -- requested tier label (free text)
  note TEXT,                               -- optional free text
  ip_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email_normalized);
