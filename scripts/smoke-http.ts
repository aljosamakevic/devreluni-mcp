#!/usr/bin/env tsx
/**
 * T04 — Local smoke test for the Phase 03 HTTP transport.
 *
 * Spawns build/index.js with MCP_TRANSPORT=http on a dedicated port,
 * waits for /health to return 200, then uses the MCP SDK's Streamable
 * HTTP client to:
 *   1. tools/list → assert all 13 tools registered (exact-name match).
 *   2. tools/call get_category_failure_modes → assert ToolResult<T> envelope
 *      shape (data, sources, confidence_note, fallbacks_used).
 *
 * Exits 0 on success, 1 on any failure. Child process is killed on
 * completion / error to avoid orphans.
 *
 * No auth yet — Stream B has not landed. Once T07 wires authRequired
 * onto /mcp, this script will need a token.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PORT = Number.parseInt(process.env['SMOKE_PORT'] ?? '3099', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const ENDPOINT = `${BASE}/mcp`;

// Expected tools in registration order from src/index.ts.
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

async function waitForHealth(timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`/health did not return 200 within ${timeoutMs}ms: ${String(lastErr)}`);
}

function startServer(): ChildProcessWithoutNullStreams {
  const child = spawn('node', ['build/index.js'], {
    env: { ...process.env, MCP_TRANSPORT: 'http', PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (chunk: Buffer) => {
    // Forward server logs so smoke failures can be diagnosed.
    process.stderr.write(`[server] ${chunk.toString()}`);
  });
  child.stdout.on('data', (chunk: Buffer) => {
    process.stderr.write(`[server-stdout] ${chunk.toString()}`);
  });
  return child;
}

interface ToolEnvelope {
  data?: unknown;
  sources?: unknown;
  confidence_note?: unknown;
  fallbacks_used?: unknown;
}

async function main(): Promise<void> {
  const server = startServer();
  let exitCode = 0;
  try {
    await waitForHealth();

    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT));
    const client = new Client({ name: 'smoke-http', version: '0.1.0' });
    await client.connect(transport);

    const list = await client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    const expectedSorted = [...EXPECTED_TOOLS].sort();
    const missing = expectedSorted.filter((n) => !names.includes(n));
    const extra = names.filter((n) => !expectedSorted.includes(n));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `tools/list mismatch — missing=[${missing.join(',')}] extra=[${extra.join(',')}]`
      );
    }
    console.log(`${names.length} of ${EXPECTED_TOOLS.length} tools listed via HTTP`);

    // Sample tools/call — get_category_failure_modes accepts a category string.
    const call = await client.callTool({
      name: 'get_category_failure_modes',
      arguments: { category: 'focus-app' },
    });

    // Extract the JSON payload from the MCP CallToolResult.
    const textBlock = (call.content as Array<{ type: string; text?: string }> | undefined)?.find(
      (c) => c.type === 'text'
    );
    if (!textBlock || typeof textBlock.text !== 'string') {
      throw new Error('tools/call returned no text content block');
    }
    let envelope: ToolEnvelope;
    try {
      envelope = JSON.parse(textBlock.text) as ToolEnvelope;
    } catch (err) {
      throw new Error(`tools/call returned non-JSON text: ${String(err)}`);
    }
    const envelopeKeys = ['data', 'sources', 'confidence_note', 'fallbacks_used'] as const;
    const missingFields = envelopeKeys.filter((k) => !(k in envelope));
    if (missingFields.length > 0) {
      throw new Error(`ToolResult envelope missing fields: ${missingFields.join(',')}`);
    }
    console.log('Sample tool response envelope: all 4 fields present (data, sources, confidence_note, fallbacks_used)');

    await client.close();
    console.log('SMOKE OK');
  } catch (err) {
    console.error('SMOKE FAILED:', err instanceof Error ? err.message : String(err));
    exitCode = 1;
  } finally {
    server.kill('SIGTERM');
    // Give it 500ms to exit cleanly, then SIGKILL.
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        server.kill('SIGKILL');
        resolve();
      }, 500);
      server.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Unexpected error in smoke-http:', err);
  process.exit(1);
});
