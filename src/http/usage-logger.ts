// Phase 03 T14 — usage_log insertion hook for tools/call requests.
//
// Wraps the POST /mcp handler so we measure duration (request receipt →
// response send) and inspect both the HTTP status code and the JSON-RPC
// response body for an `error` field. One usage_log row is inserted per
// tools/call request. Other JSON-RPC methods (initialize, tools/list,
// ping, etc.) are NOT logged — only tools/call counts toward usage.
//
// Status field:
//   'ok'    — HTTP 2xx AND no JSON-RPC error field in the response body
//   'error' — HTTP >=400 OR a JSON-RPC error field is present
//   'rate_limited' rows are inserted by src/ratelimit/middleware.ts and
//                  are NEVER inserted by this hook (avoids double-counting).
//                  This hook only fires AFTER the transport handler has run,
//                  which means we're already past T13's gate.
//
// Hook mechanism: we intercept res.write and res.end to capture the body
// chunks the SDK transport emits (enableJsonResponse: true writes a single
// JSON blob), then on res 'finish' we have both the body and the final
// status code. Best-effort — if body parsing fails, we still log with the
// HTTP-status fallback.

import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/connection.js';
import '../auth/types.js'; // declaration merge for req.tokenId.

interface JsonRpcLike {
  jsonrpc?: string;
  method?: string;
  params?: { name?: unknown };
  error?: unknown;
  result?: unknown;
}

function extractToolName(req: Request): string | null {
  const body = req.body as JsonRpcLike | undefined;
  if (
    body &&
    body.method === 'tools/call' &&
    body.params &&
    typeof body.params.name === 'string'
  ) {
    return body.params.name;
  }
  return null;
}

/**
 * Express middleware: wraps res.write / res.end to capture the response
 * body, then on 'finish' inserts one row into usage_log if the request
 * was a tools/call. Must be installed BEFORE the transport handler.
 */
export function usageLogHook(req: Request, res: Response, next: NextFunction): void {
  const toolName = extractToolName(req);

  // Non-tools/call requests are not tracked — skip the wrapping cost.
  if (!toolName) {
    next();
    return;
  }

  const startMs = Date.now();
  const chunks: Buffer[] = [];

  const originalWrite = res.write.bind(res) as Response['write'];
  const originalEnd = res.end.bind(res) as Response['end'];

  // Express overloads use untyped variadic args. Cast through `any` here is
  // localized to the wrappers; the public Response type is unchanged.
  res.write = function (chunk: unknown, ...rest: unknown[]) {
    if (chunk) {
      try {
        chunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
        );
      } catch {
        // best-effort
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalWrite as any)(chunk, ...rest);
  } as Response['write'];

  res.end = function (chunk: unknown, ...rest: unknown[]) {
    if (chunk) {
      try {
        chunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
        );
      } catch {
        // best-effort
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalEnd as any)(chunk, ...rest);
  } as Response['end'];

  res.on('finish', () => {
    // T13 already inserted a status='rate_limited' row before responding —
    // never double-count.
    if (res.statusCode === 429) return;

    const tokenId = req.tokenId;
    if (typeof tokenId !== 'number') {
      // No authenticated token (shouldn't happen — authRequired runs first
      // on POST /mcp). Skip rather than insert with a synthetic id.
      return;
    }

    const durationMs = Math.max(0, Date.now() - startMs);
    const httpError = res.statusCode >= 400;

    let jsonRpcError = false;
    try {
      const body = Buffer.concat(chunks).toString('utf8');
      if (body.length > 0) {
        const parsed = JSON.parse(body) as JsonRpcLike;
        if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error) {
          jsonRpcError = true;
        }
      }
    } catch {
      // body wasn't JSON / parsing failed — fall back to HTTP-status check only.
    }

    const status = httpError || jsonRpcError ? 'error' : 'ok';

    try {
      getDb()
        .prepare(
          `INSERT INTO usage_log (token_id, tool_name, duration_ms, status, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(tokenId, toolName, durationMs, status, new Date().toISOString());
    } catch (err) {
      console.error('[usage-logger] failed to insert usage_log row:', err);
    }
  });

  next();
}
