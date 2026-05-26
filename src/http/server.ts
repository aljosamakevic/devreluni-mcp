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

export function createHttpServer(mcpServer: McpServer): HttpServerHandle {
  // host '0.0.0.0' for Fly.io — containers can't bind 127.0.0.1 and serve external traffic.
  // createMcpExpressApp already wires express.json() and (for localhost hosts) DNS-rebind protection.
  const app = createMcpExpressApp({ host: '0.0.0.0' });
  app.disable('x-powered-by');

  // In-memory map keyed by mcp-session-id header. Stateful mode.
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // GET /health — Fly healthcheck endpoint. Always 200; subsystem failures surface in
  // the body's `status` field ("degraded") rather than as a non-2xx (per PLAN T03 design).
  // T22 enriches this with DB + cache + last-error timestamp.
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      version: PACKAGE_VERSION,
      uptime_s: Math.floor(process.uptime()),
      db_ok: true, // Phase 03 T22 wires this to a real SQLite SELECT 1 check.
      transport: 'http',
      checked_at: new Date().toISOString(),
    });
  });

  app.post('/mcp', async (req: Request, res: Response) => {
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

        await mcpServer.connect(transport);
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
      console.error('Error handling MCP request:', error);
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

  // Route ordering reserved for downstream tasks:
  //   GET /health        — T03 (Stream A)
  //   GET /admin/*       — T27/T28 (Stream F), basic-auth gated
  //   GET /              — T26 (Stream F), express.static('public')
  // Static mount MUST be wired LAST so it doesn't shadow named routes.

  return {
    app,
    listen: (port: number): HttpServer => {
      return app.listen(port);
    },
  };
}

// Re-export express helpers downstream tasks may need.
export { express };
