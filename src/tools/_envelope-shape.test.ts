/**
 * Phase 09 T08 — structural regression: every tool file must:
 *   (a) advertise the status envelope in its description (visible to
 *       calling LLMs via MCP tools/list at discovery time);
 *   (b) route returns through src/lib/envelope.ts helpers (so the status
 *       discriminator can never be accidentally omitted).
 *
 * This is a static-text check, not a runtime invocation. TypeScript already
 * enforces the shape at compile time (status is required on ToolResult<T>),
 * so a runtime envelope-shape check would just duplicate tsc. What slips
 * past the type system is the *description text* and *helper usage* —
 * adding a 14th tool that forgets to advertise the envelope is a type-safe
 * mistake. This test catches it.
 *
 * Runtime envelope behavior is covered end-to-end by
 *   * scripts/assert-fomi-run.ts (Phase 01 INVIOLATE regression gate)
 *   * scripts/smoke-http.ts       (tools/list + tools/call across all 13)
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TOOLS_DIR = join(import.meta.dirname, '..', '..', 'src', 'tools');

function listToolFiles(): string[] {
  return readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => !f.endsWith('.test.ts'))
    .filter((f) => !f.startsWith('_'));
}

describe('tool envelope shape — structural regression', () => {
  const files = listToolFiles();

  it('lists exactly 13 tool files', () => {
    expect(files).toHaveLength(13);
  });

  it.each(files)('%s advertises the status envelope in its description', (file) => {
    const src = readFileSync(join(TOOLS_DIR, file), 'utf8');
    expect(src, `${file}: missing "Envelope:" clause in tool description`).toMatch(
      /Envelope: \{ status: 'ok'\|('honest_gap'\|)?'error'/,
    );
  });

  it.each(files)('%s imports an envelope helper from lib/envelope', (file) => {
    const src = readFileSync(join(TOOLS_DIR, file), 'utf8');
    expect(src, `${file}: must import okResult / honestGapResult / errorResult from ../lib/envelope.js`).toMatch(
      /from ['"]\.\.\/lib\/envelope\.js['"]/,
    );
  });
});
