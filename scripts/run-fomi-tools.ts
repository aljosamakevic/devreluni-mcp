#!/usr/bin/env tsx
/**
 * T-final-3 — Fresh end-to-end Fomi tool orchestration.
 *
 * Spawns `node build/index.js` over stdio, sends MCP `initialize` +
 * `tools/call` for the 12 tools the `validate_idea` prompt fires for the
 * Fomi case, and saves each raw tool response under
 * `.planning/validation-runs/02-fomi-tool-responses/<tool>.json`.
 *
 * This is the data-capture half of T-final-3. A separate step constructs
 * the ValidationReport JSON from these captures and calls
 * `finalize_validation_report` to produce the final artifact.
 */

import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(REPO_ROOT, '.planning/validation-runs/02-fomi-tool-responses');
mkdirSync(OUT_DIR, { recursive: true });

// ─── JSON-RPC stdio client ───────────────────────────────────────────────

interface RpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

class StdioClient {
  private proc: ChildProcessWithoutNullStreams;
  private buf = '';
  private pending = new Map<number, (r: RpcResponse) => void>();
  private nextId = 1;

  constructor() {
    this.proc = spawn('node', ['build/index.js'], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    this.proc.stdout.setEncoding('utf-8');
    this.proc.stdout.on('data', (chunk: string) => this.onData(chunk));
    this.proc.stderr.on('data', (d) => process.stderr.write(`[mcp] ${d}`));
    this.proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        process.stderr.write(`[mcp] exited code=${code}\n`);
      }
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg: RpcResponse;
      try {
        msg = JSON.parse(line);
      } catch {
        process.stderr.write(`[mcp] non-JSON line: ${line}\n`);
        continue;
      }
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const cb = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        cb(msg);
      }
    }
  }

  request(method: string, params?: unknown, timeoutMs = 120000): Promise<RpcResponse> {
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params } as const;
    return new Promise((resolveP, rejectP) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectP(new Error(`Timeout waiting for ${method} (id=${id})`));
      }, timeoutMs);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        resolveP(r);
      });
      this.proc.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  notify(method: string, params?: unknown): void {
    const payload = { jsonrpc: '2.0', method, params };
    this.proc.stdin.write(JSON.stringify(payload) + '\n');
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

// ─── Tool plan ───────────────────────────────────────────────────────────

const FRAMING = { audience: 'B2C' as const, builder: 'solo' as const };
const IDEA =
  'AI-native focus app that monitors screens to keep users on-task. Detects when users drift off-task (social media, distracting sites), gently nudges back via interventions. Uses cloud screenshot analysis.';
const CATEGORY = 'focus app';
const CATEGORY_KEYWORDS = ['screen time', 'deep work', 'on-task', 'distraction blocker'];
const COMPETITORS = ['RescueTime', 'Freedom', 'Forest', 'Rize', 'Cold Turkey', 'Opal', 'Focus Bear'];

interface Call {
  outFile: string;
  tool: string;
  args: Record<string, unknown>;
}

const CALLS: Call[] = [
  // Gate 1
  {
    outFile: 'find_closest_competitor.json',
    tool: 'find_closest_competitor',
    args: { idea_description: IDEA, search_angle: 'ADHD on-task screen monitoring 2025' },
  },
  {
    outFile: 'read_competitor_changelog.json',
    tool: 'read_competitor_changelog',
    args: { product: 'Fomi' },
  },
  {
    outFile: 'map_competitive_weaknesses.json',
    tool: 'map_competitive_weaknesses',
    args: { competitor_name: 'Fomi', category: CATEGORY },
  },
  // Gate 1 contradicting
  {
    outFile: 'contra_g1.json',
    tool: 'find_closest_competitor',
    args: { idea_description: IDEA, search_angle: 'profitable indie AI focus app success story 2025' },
  },
  // Gate 2
  {
    outFile: 'estimate_demand_signals.json',
    tool: 'estimate_demand_signals',
    args: {
      idea_description: IDEA,
      category: CATEGORY,
      category_keywords: CATEGORY_KEYWORDS,
      candidate_subreddits: ['productivity', 'focus', 'getdisciplined', 'ADHD', 'ADHD_Programmers'],
      candidate_repos: ['focus productivity tracker | pomodoro'],
    },
  },
  {
    outFile: 'find_public_revenue_signals.json',
    tool: 'find_public_revenue_signals',
    args: { category: CATEGORY, competitors: COMPETITORS.slice(0, 5), framing: FRAMING },
  },
  // Gate 3
  {
    outFile: 'check_big_tech_encroachment.json',
    tool: 'check_big_tech_encroachment',
    args: {
      idea_description: IDEA,
      category: CATEGORY,
      category_keywords: CATEGORY_KEYWORDS,
    },
  },
  {
    outFile: 'assess_platform_dependency.json',
    tool: 'assess_platform_dependency',
    args: {
      idea_description: IDEA,
      category: CATEGORY,
      explicit_platforms: ['Apple Screen Time API', 'Android Digital Wellbeing', 'macOS', 'iOS'],
      framing: FRAMING,
    },
  },
  // Gate 4
  {
    outFile: 'find_pricing_anchors.json',
    tool: 'find_pricing_anchors',
    args: { category: CATEGORY, competitors: COMPETITORS, framing: FRAMING },
  },
  // Gate 5
  {
    outFile: 'find_why_now_signals.json',
    tool: 'find_why_now_signals',
    args: { idea_description: IDEA, category: CATEGORY, category_keywords: CATEGORY_KEYWORDS },
  },
  {
    outFile: 'find_yc_rfs_alignment.json',
    tool: 'find_yc_rfs_alignment',
    args: { idea_description: IDEA },
  },
  // Cross-gate
  {
    outFile: 'get_category_failure_modes.json',
    tool: 'get_category_failure_modes',
    args: { category: CATEGORY, known_products: COMPETITORS },
  },
  {
    outFile: 'scan_producthunt_launches.json',
    tool: 'scan_producthunt_launches',
    args: { category: CATEGORY },
  },
];

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const client = new StdioClient();

  const initRes = await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 't-final-3-orchestrator', version: '1.0.0' },
  });
  if (initRes.error) throw new Error(`initialize failed: ${JSON.stringify(initRes.error)}`);
  client.notify('notifications/initialized');

  // Tool count probe
  const list = await client.request('tools/list');
  const tools = ((list.result as { tools?: Array<{ name: string }> })?.tools ?? []).map((t) => t.name);
  process.stderr.write(`[probe] tools registered: ${tools.length}\n`);
  process.stderr.write(`[probe] tools: ${tools.join(', ')}\n`);
  writeFileSync(resolve(OUT_DIR, '_tools-list.json'), JSON.stringify(tools, null, 2));

  const summary: Array<{ tool: string; outFile: string; succeeded: boolean; failure_note?: string }> = [];

  for (const call of CALLS) {
    process.stderr.write(`[call] ${call.tool} → ${call.outFile}\n`);
    try {
      const res = await client.request('tools/call', {
        name: call.tool,
        arguments: call.args,
      });
      if (res.error) {
        writeFileSync(resolve(OUT_DIR, call.outFile), JSON.stringify({ error: res.error }, null, 2));
        summary.push({ tool: call.tool, outFile: call.outFile, succeeded: false, failure_note: res.error.message });
        continue;
      }
      const content = (res.result as { content?: Array<{ type: string; text?: string }> })?.content ?? [];
      const text = content[0]?.text ?? '';
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // leave as raw string
      }
      writeFileSync(resolve(OUT_DIR, call.outFile), JSON.stringify(parsed, null, 2));
      summary.push({ tool: call.tool, outFile: call.outFile, succeeded: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      writeFileSync(resolve(OUT_DIR, call.outFile), JSON.stringify({ error: msg }, null, 2));
      summary.push({ tool: call.tool, outFile: call.outFile, succeeded: false, failure_note: msg });
    }
  }

  writeFileSync(resolve(OUT_DIR, '_call-summary.json'), JSON.stringify(summary, null, 2));
  process.stderr.write(`[done] ${summary.filter((s) => s.succeeded).length}/${summary.length} succeeded\n`);
  client.close();
}

main().catch((e) => {
  process.stderr.write(`[fatal] ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
