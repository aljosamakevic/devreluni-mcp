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
