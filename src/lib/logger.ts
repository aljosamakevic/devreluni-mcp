// Phase 03 T21 — structured pino logger for the HTTP transport.
//
// Design (per PLAN T21 + CONTEXT.md decision 8 + R6 admin-password leakage):
//
//   * Output: JSON to stdout. Fly captures stdout into its log stream.
//   * Level: `info` default; warn for rate-limit + global-cap hits; error for crashes.
//   * Redaction has two layers:
//
//     1. PATH-BASED — handled by pino's native `redact.paths` option. We list:
//          *.authorization, *.token, *.token_hash, *.password
//        plus a few top-level forms ('authorization', 'token', ...) so a
//        flat `{ authorization: '...' }` payload is also caught. pino's
//        wildcard `*.foo` syntax matches `foo` exactly ONE level deep
//        under any key; the bare top-level forms cover the shallow case.
//        Verified against /pinojs/pino docs (redaction.md → "Path Syntax")
//        + the live behavior of pino@10.3.1.
//
//     2. SUBSTRING-BASED — for actual secret VALUES that may show up inside
//        any string field. pino's `redact.paths` does not do substring
//        matching, so we use a `formatters.log` hook that walks the log
//        object and replaces any string containing one of the watched
//        env-var values with `[Redacted]`. The watched env vars are:
//
//          SERPER_API_KEY, PRODUCTHUNT_API_KEY, GITHUB_TOKEN, ADMIN_PASSWORD
//
//        When a given env var is unset (or empty), it's silently skipped —
//        the scrub becomes a no-op for that key. This is intentional: in
//        local dev `ADMIN_PASSWORD` is often unset, and we don't want the
//        logger to fail or scrub literal empty strings.
//
//        Snapshot the env values once at logger-construction time so a
//        later `process.env.ADMIN_PASSWORD = ...` reassignment doesn't
//        change scrub behavior mid-run. This matches how Fly secrets work
//        (set at boot, immutable until restart).
//
//   * `body` field truncation — request bodies can be large (smoke tests
//     exercise 500-char payloads). The same `formatters.log` hook truncates
//     any string-valued field literally named `body` to 200 chars and
//     appends `... [truncated]`. This is applied AFTER substring scrubbing
//     so truncation can't accidentally leave a partial secret in view.
//
// STDIO TRANSPORT NOTE: this logger writes to STDOUT. The stdio MCP
// transport uses stdout for the JSON-RPC channel — never import this logger
// into src/index.ts's stdio branch (src/index.ts keeps `console.error`).
// HTTP transport only.

import { pino } from 'pino';

// Snapshot watched env values at module load. Empty / missing → skipped.
const WATCHED_ENV_VARS = [
  'SERPER_API_KEY',
  'PRODUCTHUNT_API_KEY',
  'GITHUB_TOKEN',
  'ADMIN_PASSWORD',
] as const;

const SECRET_VALUES: string[] = WATCHED_ENV_VARS.map((k) => process.env[k] ?? '').filter(
  (v) => v.length > 0
);

const REDACTED = '[Redacted]';
const BODY_MAX_CHARS = 200;

/** Walk an arbitrary log object and apply substring + body-truncation scrubbing. */
function scrubLogObject(input: Record<string, unknown>): Record<string, unknown> {
  // Use a fresh shallow shape; recursive walk handles nested objects/arrays.
  return walk(input) as Record<string, unknown>;
}

function walk(value: unknown, keyName?: string): unknown {
  if (typeof value === 'string') {
    let out = scrubString(value);
    if (keyName === 'body' && out.length > BODY_MAX_CHARS) {
      out = out.slice(0, BODY_MAX_CHARS) + '... [truncated]';
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((v) => walk(v));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walk(v, k);
    }
    return out;
  }
  return value;
}

function scrubString(s: string): string {
  if (SECRET_VALUES.length === 0) return s;
  for (const secret of SECRET_VALUES) {
    if (s.includes(secret)) {
      // Replace ALL occurrences of the secret in the string with [Redacted].
      // Using split/join (no regex) sidesteps regex-escaping concerns for
      // arbitrary env-var contents (passwords can include regex metachars).
      s = s.split(secret).join(REDACTED);
    }
  }
  return s;
}

// Phase 03 T22 — in-memory ring buffer (capacity 1) tracking the timestamp
// of the most recent `logger.error(...)` call. Resets to null on boot.
// GET /health surfaces this as `last_error_at`. The `error` level number
// in pino is 50; anything >= 50 (error, fatal) bumps the timestamp.
let lastErrorAt: string | null = null;
const ERROR_LEVEL = 50;

export function getLastErrorAt(): string | null {
  return lastErrorAt;
}

export function __resetLastErrorAtForTests(): void {
  lastErrorAt = null;
}

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  hooks: {
    // logMethod fires before the log line is emitted. We use it ONLY to
    // sniff the level number and bump lastErrorAt — it does not transform
    // arguments. Always delegates to method.apply(this, args) untouched.
    logMethod(args, method, level) {
      if (level >= ERROR_LEVEL) {
        lastErrorAt = new Date().toISOString();
      }
      return method.apply(this, args);
    },
  },
  redact: {
    // Top-level forms catch `{ authorization: '...' }`; `*.foo` forms catch
    // nested `{ req: { authorization: '...' } }`. See header comment.
    paths: [
      'authorization',
      'token',
      'token_hash',
      'password',
      '*.authorization',
      '*.token',
      '*.token_hash',
      '*.password',
    ],
    censor: REDACTED,
  },
  formatters: {
    // Runs once per log call, BEFORE serialization. Applies both substring
    // scrubbing (env-var values anywhere in any string) and body truncation.
    // Path-based redaction (above) runs AFTER this — order is fine because
    // path-based redaction never reads truncated/scrubbed values; it just
    // replaces the named keys with the censor literal.
    log(object) {
      return scrubLogObject(object);
    },
  },
});

// Test seam — re-snapshot watched env values. ONLY used by tests that need
// to verify scrubbing for an env value that was unset at module load.
// Not for production code paths.
export function __resnapshotSecretsForTests(): void {
  SECRET_VALUES.length = 0;
  for (const k of WATCHED_ENV_VARS) {
    const v = process.env[k];
    if (v && v.length > 0) SECRET_VALUES.push(v);
  }
}
