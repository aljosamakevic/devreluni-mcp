// Phase 03 T07 — Express authRequired middleware.
//
// Validates Authorization: Bearer pv_<token>. On failure: 401 + the
// WWW-Authenticate header whose value is the WWW_AUTH constant below
// (single source of truth — see CONTEXT.md success criteria + T08
// exact-string grep lock). Do NOT inline the literal anywhere else; that
// would break the grep contract and risks drift if the realm ever moves.
//
// Pure middleware: never consumes or rewrites req.body — the Streamable HTTP
// transport reads body downstream and createMcpExpressApp already ran
// express.json() upstream.

import type { Request, Response, NextFunction } from 'express';
import { validateToken } from './tokens.js';
import './types.js'; // declaration merge for req.tokenId / req.tokenEmail.

// Phase 14 — the 401 now points clients at the OAuth Protected Resource
// Metadata (RFC 9728) so MCP clients (e.g. claude.ai) can discover the
// authorization server and start the OAuth flow. Static bearer tokens still
// work unchanged; this header only guides clients that DON'T already have one.
const RESOURCE_METADATA_URL = `${process.env['BASE_URL'] ?? 'https://getvetoed.com'}/.well-known/oauth-protected-resource`;
const WWW_AUTH = `Bearer realm="vetoed", resource_metadata="${RESOURCE_METADATA_URL}"`;

export function authRequired(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['authorization'];
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    res.setHeader('WWW-Authenticate', WWW_AUTH);
    res
      .status(401)
      .json({ error: 'unauthorized', reason: 'missing_or_malformed_authorization_header' });
    return;
  }

  const rawToken = header.slice('Bearer '.length).trim();
  if (rawToken.length === 0) {
    res.setHeader('WWW-Authenticate', WWW_AUTH);
    res
      .status(401)
      .json({ error: 'unauthorized', reason: 'missing_or_malformed_authorization_header' });
    return;
  }

  const result = validateToken(rawToken);
  if (!result) {
    res.setHeader('WWW-Authenticate', WWW_AUTH);
    res.status(401).json({ error: 'unauthorized', reason: 'invalid_or_revoked_token' });
    return;
  }

  req.tokenId = result.id;
  req.tokenEmail = result.email;
  next();
}
