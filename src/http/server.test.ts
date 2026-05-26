// Phase 03 D-03-7 — Regression test: multi-session McpServer factory.
//
// Background: src/index.ts previously created one McpServer at boot and passed
// the same instance to createHttpServer. The SDK Server's `_transport` field
// is sticky once `connect()` runs, so the SECOND initialize from a new client
// session threw "Already connected to a transport. Call close() before
// connecting to a new transport, or use a separate Protocol instance per
// connection." — surfaced to the wire as HTTP 500 with code -32603.
//
// Fix: createHttpServer now accepts a `getServer: () => McpServer` factory and
// calls it once per initialize. This test drives that contract directly via
// supertest:
//   (a) POST initialize on a fresh server with bearer auth → 200, capture
//       mcp-session-id;
//   (b) POST a second initialize (no session id) → 200 with a DIFFERENT
//       session id (proves a fresh McpServer was created per session);
//   (c) POST tools/list on each session → 13 tools each (same registration
//       order, same names, same total — Phase 01 inviolate contract).
//
// Acceptance failure mode: if the factory regresses to a single-shared
// instance, step (b) collapses to a 500 with body
//   { jsonrpc:'2.0', error:{ code:-32603, message:'Internal server error' }, id:null }
// and this test fails immediately.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { __resetDbForTests, getDb } from '../db/connection.js';
import { issueToken } from '../auth/tokens.js';
import { createMcpServer } from '../index.js';
import { createHttpServer } from './server.js';

const DB_PATH = join(tmpdir(), `vetoed-test-server-${randomBytes(6).toString('hex')}.db`);

// Expected tool names — matches scripts/smoke-http.ts EXPECTED_TOOLS verbatim
// and the registration order in src/index.ts createMcpServer().
const EXPECTED_TOOLS = [
  'find_closest_competitor',
  'read_competitor_changelog',
  'map_competitive_weaknesses',
  'scan_producthunt_launches',
  'get_category_failure_modes',
  'find_yc_rfs_alignment',
  'find_pricing_anchors',
  'check_big_tech_encroachment',
  'find_why_now_signals',
  'estimate_demand_signals',
  'find_public_revenue_signals',
  'assess_platform_dependency',
  'finalize_validation_report',
];

const INIT_BODY = {
  jsonrpc: '2.0' as const,
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'server-test', version: '0.1.0' },
  },
};

const TOOLS_LIST_BODY = {
  jsonrpc: '2.0' as const,
  id: 2,
  method: 'tools/list',
  params: {},
};

// The Streamable HTTP transport requires the client to advertise both content
// types in Accept; otherwise it 406s before reaching our session logic.
const ACCEPT_HEADER = 'application/json, text/event-stream';

function cleanup(): void {
  __resetDbForTests();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${DB_PATH}${suffix}`;
    if (existsSync(p)) {
      try {
        rmSync(p);
      } catch {
        // best-effort
      }
    }
  }
}

beforeAll(() => {
  process.env['VETOED_DB_PATH'] = DB_PATH;
  // adminAuthRequired fails closed when ADMIN_PASSWORD is unset; the test
  // never hits /admin/*, but createHttpServer wires the gate at app build
  // time, so set a placeholder password to keep the build silent.
  process.env['ADMIN_PASSWORD'] = 'test-password-server-test';
  cleanup();
  getDb();
});

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM usage_log;');
  db.exec('DELETE FROM tokens;');
});

afterAll(() => {
  cleanup();
});

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: { tools?: Array<{ name: string }>; protocolVersion?: string };
  error?: { code: number; message: string };
}

describe('createHttpServer — per-session McpServer factory (D-03-7 regression)', () => {
  it('serves two back-to-back sessions with distinct mcp-session-id values', async () => {
    const issued = issueToken('multi-session@example.com');
    const bearer = `Bearer ${issued.token}`;

    // Per-session factory — exactly what src/index.ts passes in HTTP mode.
    const { app } = createHttpServer(createMcpServer);

    // (a) Session 1 — initialize.
    const s1Init = await request(app)
      .post('/mcp')
      .set('Authorization', bearer)
      .set('Accept', ACCEPT_HEADER)
      .set('Content-Type', 'application/json')
      .send(INIT_BODY);

    expect(s1Init.status).toBe(200);
    const s1Id = s1Init.headers['mcp-session-id'];
    expect(typeof s1Id).toBe('string');
    expect(s1Id.length).toBeGreaterThan(0);
    const s1Body = s1Init.body as JsonRpcResponse;
    expect(s1Body.error).toBeUndefined();
    expect(s1Body.result?.protocolVersion).toBeDefined();

    // (b) Session 2 — second initialize WITH NO session id header. Under the
    // pre-D-03-7 bug this returned HTTP 500 + code -32603 because the shared
    // McpServer threw "Already connected to a transport". With the factory
    // fix, a fresh McpServer is built and a new session id is minted.
    const s2Init = await request(app)
      .post('/mcp')
      .set('Authorization', bearer)
      .set('Accept', ACCEPT_HEADER)
      .set('Content-Type', 'application/json')
      .send(INIT_BODY);

    expect(s2Init.status).toBe(200);
    const s2Id = s2Init.headers['mcp-session-id'];
    expect(typeof s2Id).toBe('string');
    expect(s2Id.length).toBeGreaterThan(0);
    expect(s2Id).not.toBe(s1Id); // distinct sessions = fresh McpServer per init
    const s2Body = s2Init.body as JsonRpcResponse;
    expect(s2Body.error).toBeUndefined();

    // (c) tools/list on each session — both independently see all 13 tools.
    const s1List = await request(app)
      .post('/mcp')
      .set('Authorization', bearer)
      .set('Accept', ACCEPT_HEADER)
      .set('Content-Type', 'application/json')
      .set('mcp-session-id', s1Id)
      .set('mcp-protocol-version', '2025-03-26')
      .send(TOOLS_LIST_BODY);

    expect(s1List.status).toBe(200);
    const s1ListBody = s1List.body as JsonRpcResponse;
    expect(s1ListBody.error).toBeUndefined();
    const s1ToolNames = (s1ListBody.result?.tools ?? []).map((t) => t.name).sort();
    expect(s1ToolNames).toEqual([...EXPECTED_TOOLS].sort());

    const s2List = await request(app)
      .post('/mcp')
      .set('Authorization', bearer)
      .set('Accept', ACCEPT_HEADER)
      .set('Content-Type', 'application/json')
      .set('mcp-session-id', s2Id)
      .set('mcp-protocol-version', '2025-03-26')
      .send(TOOLS_LIST_BODY);

    expect(s2List.status).toBe(200);
    const s2ListBody = s2List.body as JsonRpcResponse;
    expect(s2ListBody.error).toBeUndefined();
    const s2ToolNames = (s2ListBody.result?.tools ?? []).map((t) => t.name).sort();
    expect(s2ToolNames).toEqual([...EXPECTED_TOOLS].sort());
  });
});
