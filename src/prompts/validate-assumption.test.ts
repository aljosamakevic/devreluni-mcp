// Phase 07 T03 — Registration + body rendering tests for validate_assumption.
//
// Pattern: spin up a fresh McpServer via the canonical factory (createMcpServer
// in src/index.ts), pair it with an MCP Client over InMemoryTransport (no HTTP,
// no stdio child), and drive prompts/list + prompts/get directly. This isolates
// the test from auth + DB + rate-limit concerns; we are validating prompt body
// shape, not transport.

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../index.js';

async function connectInMemoryClient(): Promise<Client> {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'validate-assumption-test', version: '0.0.1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function extractText(result: { messages: Array<{ content: { type: string; text?: string } }> }): string {
  const first = result.messages[0];
  if (!first || first.content.type !== 'text' || typeof first.content.text !== 'string') {
    throw new Error('validate_assumption returned no text content');
  }
  return first.content.text;
}

describe('validate_assumption prompt', () => {
  it('appears in prompts/list with the locked argument schema', async () => {
    const client = await connectInMemoryClient();
    try {
      const list = await client.listPrompts();
      const entry = list.prompts.find((p) => p.name === 'validate_assumption');
      expect(entry, 'validate_assumption must be registered').toBeDefined();

      const args = entry!.arguments ?? [];
      const claimArg = args.find((a) => a.name === 'claim');
      const evidenceTypeArg = args.find((a) => a.name === 'evidence_type');

      expect(claimArg, 'claim arg present').toBeDefined();
      expect(claimArg!.required).toBe(true);

      expect(evidenceTypeArg, 'evidence_type arg present').toBeDefined();
      expect(evidenceTypeArg!.required).toBe(false);
    } finally {
      await client.close();
    }
  });

  it('renders the body with the claim interpolated, auto-route routing, and all anti-bias mandates', async () => {
    const client = await connectInMemoryClient();
    try {
      const result = await client.getPrompt({
        name: 'validate_assumption',
        arguments: { claim: 'Cold Turkey has 80k paying users' },
      });
      const text = extractText(result);

      // Claim verbatim — both at top and bottom of the body.
      expect(text).toContain('"Cold Turkey has 80k paying users"');

      // Auto-route label appears when evidence_type is omitted.
      expect(text).toContain('(auto-route)');

      // Verdict template heading from CONTEXT.md decision 7 is verbatim.
      expect(text).toContain('# Assumption verdict');

      // Three anti-bias mechanics, all grep-locked.
      expect(text).toContain('tier-grade every fact');
      expect(text).toContain('bias-flag every source');
      expect(text).toContain('contradicting evidence BEFORE forming the verdict');

      // Contradicting-evidence search is MANDATORY, not optional.
      expect(text).toContain('MANDATORY, NOT optional');

      // Verdict labels rendered as a literal pipe-separated list.
      expect(text).toContain('SUPPORTED | REFUTED | INCONCLUSIVE');
      expect(text).toContain('HIGH | MEDIUM | LOW');

      // Routed via label echoes the evidence_type — for auto-route it is the literal "(auto-route)".
      expect(text).toContain('**Routed via:** (auto-route)');
    } finally {
      await client.close();
    }
  });

  it('renders the body with the typed evidence_type routing label (pricing)', async () => {
    const client = await connectInMemoryClient();
    try {
      const result = await client.getPrompt({
        name: 'validate_assumption',
        arguments: { claim: 'Forest prices at $1.99/mo', evidence_type: 'pricing' },
      });
      const text = extractText(result);

      expect(text).toContain('"Forest prices at $1.99/mo"');
      // Typed routing must echo "Routing: pricing" verbatim (per PLAN.md T03 ac).
      expect(text).toContain('Routing: pricing');
      // The "Routed via" line in the rendered template should reflect the typed evidence_type.
      expect(text).toContain('**Routed via:** pricing');
      // Auto-route guidance must NOT appear when evidence_type is provided.
      expect(text).not.toContain('Routing: auto-route');
    } finally {
      await client.close();
    }
  });

  it('rejects an invalid evidence_type via the zod enum guard', async () => {
    const client = await connectInMemoryClient();
    try {
      await expect(
        client.getPrompt({
          name: 'validate_assumption',
          arguments: { claim: 'irrelevant', evidence_type: 'garbage' as unknown as 'pricing' },
        })
      ).rejects.toThrow();
    } finally {
      await client.close();
    }
  });
});
