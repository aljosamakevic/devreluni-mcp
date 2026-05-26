// Phase 03.1 D-03-7 regression test.
//
// Verifies that the HTTP transport can serve >1 MCP session per process. Pre-fix,
// createHttpServer(mcpServer) reused a single McpServer instance and the second
// session's `mcpServer.connect(transport)` threw
//   "Already connected to a transport. Call close() before connecting to a new
//    transport, or use a separate Protocol instance per connection."
// Post-fix, createHttpServer(getServer) calls the factory once per session.
//
// This test opens two SDK clients in series against the same Express app and
// asserts both initialize successfully + both list 13 tools. On the old
// singleton code, the second client.connect() returns HTTP 500.

import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Server as HttpServer } from 'node:http';
import { resolve } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createHttpServer } from './server.js';
import { createMcpServer } from '../index.js';
import { issueToken } from '../auth/tokens.js';
import { __resetDbForTests } from '../db/connection.js';

const TEST_DB = resolve(process.cwd(), `vetoed-server-test-${randomBytes(4).toString('hex')}.db`);

function cleanupDb(): void {
  __resetDbForTests();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${TEST_DB}${suffix}`;
    if (existsSync(p)) {
      try { rmSync(p); } catch { /* best-effort */ }
    }
  }
}

describe('D-03-7 — HTTP transport serves multiple sessions per process', () => {
  let httpServer: HttpServer;
  let port: number;
  let bearer: string;

  beforeEach(async () => {
    cleanupDb();
    process.env['VETOED_DB_PATH'] = TEST_DB;
    bearer = issueToken('regression@vetoed.local').token;
    __resetDbForTests(); // close parent handle; child route handlers re-open via getDb()

    const handle = createHttpServer(createMcpServer);
    // listen(0) → OS picks a free port.
    httpServer = handle.app.listen(0);
    await new Promise<void>((res, rej) => {
      httpServer.once('listening', () => res());
      httpServer.once('error', rej);
    });
    const addr = httpServer.address() as AddressInfo | null;
    if (!addr || typeof addr === 'string') throw new Error('failed to bind server');
    port = addr.port;
  });

  afterEach(async () => {
    await new Promise<void>((res) => httpServer.close(() => res()));
    cleanupDb();
  });

  async function openSession(): Promise<{ client: Client; toolCount: number }> {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } },
    );
    const client = new Client({ name: 'd-03-7-regression', version: '0.1.0' });
    await client.connect(transport);
    const list = await client.listTools();
    return { client, toolCount: list.tools.length };
  }

  it('serves two sequential sessions without "Already connected to a transport"', async () => {
    // SESSION 1 — pre-fix this passed (singleton's first connect()).
    const first = await openSession();
    expect(first.toolCount).toBe(13);
    await first.client.close();

    // SESSION 2 — pre-fix this returned HTTP 500 because the singleton's
    // second mcpServer.connect(transport) threw. Post-fix the factory hands
    // out a fresh McpServer, so this initialize succeeds and tools/list
    // returns 13 again.
    const second = await openSession();
    expect(second.toolCount).toBe(13);
    await second.client.close();
  });
});
