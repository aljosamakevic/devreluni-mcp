// Phase 07 T04 — Prompt-count regression lock.
//
// Single-purpose file: assert that the canonical createMcpServer() factory
// registers EXACTLY 6 prompts, with the exact name set below. If a future
// refactor drops a prompt (e.g., a typo in src/index.ts, a missing import,
// or an over-zealous cleanup) this test fails loudly before any downstream
// consumer notices.
//
// Lives in src/server/ rather than src/prompts/ to keep its intent (a
// server-level cross-prompt regression lock) visually distinct from the
// per-prompt body tests in src/prompts/*.test.ts.

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../index.js';

// The locked set of prompts as of Phase 07. Order-insensitive comparison —
// the registration order in src/index.ts is the source of truth for ordering,
// but this test cares only about the SET membership.
const EXPECTED_PROMPTS = [
  'validate_idea',
  'steelman_against',
  'run_single_gate',
  'generate_test_cards',
  'quick_kill_check',
  'validate_assumption',
] as const;

describe('MCP server prompt registration', () => {
  it('exposes exactly 6 prompts with the locked name set', async () => {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'prompt-count-test', version: '0.0.1' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const list = await client.listPrompts();
      const names = list.prompts.map((p) => p.name).sort();
      const expectedSorted = [...EXPECTED_PROMPTS].sort();

      // Exact count — guards against accidental additions or drops.
      expect(names).toHaveLength(EXPECTED_PROMPTS.length);
      // Exact name set — guards against renames.
      expect(names).toEqual(expectedSorted);
    } finally {
      await client.close();
    }
  });
});
