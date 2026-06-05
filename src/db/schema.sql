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
