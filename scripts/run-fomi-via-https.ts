#!/usr/bin/env tsx
/**
 * T-final-3a — HTTPS client script for the Fomi calibration regression.
 *
 * Connects to an arbitrary HTTPS MCP endpoint via Streamable HTTP (the same
 * transport class used by scripts/smoke-http.ts at @modelcontextprotocol/sdk
 * @1.29.0), authenticates with a bearer token, fetches the `validate_idea`
 * PROMPT (it is a prompt, NOT a tool — `validate_idea` orchestrates the 12
 * tools client-side via the LLM; the MCP wire call is `prompts/get`), and
 * writes the rendered prompt text (the user-role messages) to either stdout
 * or a file.
 *
 * Phase 03 split rationale (PLAN.md C9):
 *   - T-final-3a (this script + a placeholder-URL smoke) → THIS COMMIT.
 *   - T-final-3b (execute against the live deploy + capture the artifact at
 *     `.planning/validation-runs/03-fomi-via-https.md`) → gated on the Fly
 *     deploy landing and DNS resolving.
 *
 * The script does NOT itself run the 12-tool orchestration — that is the
 * LLM's job. The MCP wire call here is `prompts/get`, whose response is the
 * orchestration script the LLM will execute. T-final-3b's "fresh-LLM rerun"
 * means: copy the captured prompt response into a fresh Claude/Cursor/etc
 * session backed by this MCP endpoint, let the LLM call the 12 tools, save
 * the final `finalize_validation_report` markdown as the artifact.
 *
 * CLI:
 *   --endpoint <url>   default https://getvetoed.com/mcp
 *   --token <bearer>   or env VETOED_TEST_TOKEN
 *   --idea <text>      default Fomi case (see FOMI_IDEA_TEXT below)
 *   --audience <kind>  optional; default B2C (matches Phase 01/02 frontmatter)
 *   --builder <kind>   optional; default solo (matches Phase 01/02 frontmatter)
 *   --out <path>       optional; default stdout
 *   --help, -h         print usage and exit 0
 *
 * Placeholder smoke (per PLAN.md T-final-3a C9 acceptance):
 *   tsx scripts/run-fomi-via-https.ts \
 *       --endpoint https://127.0.0.1:1/mcp \
 *       --token pv_placeholder
 *
 *   exits non-zero with a friendly "connection failed" message — NOT a crash,
 *   NOT an unhandled-promise-rejection stack trace.
 *
 * SDK verified: @modelcontextprotocol/sdk@1.29.0
 * Crib reference: scripts/smoke-http.ts (T04) for the StreamableHTTPClientTransport
 *                 + Authorization-header pattern via `requestInit.headers`.
 */

import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// ---------------------------------------------------------------------------
// Defaults — pulled VERBATIM from the Phase 02 captured artifact frontmatter
// (.planning/validation-runs/02-fomi-regression-after-phase-02.md, Section 1
// "Idea:" line) so T-final-3b's run lines up byte-for-byte with the Phase 02
// calibration anchor. Phase 01's artifact (01-fomi-focus-app.md) uses the
// IDENTICAL idea text + framing — the two captures agree, so either could
// be the source-of-truth here; Phase 02 chosen because it is the more
// recent calibration anchor and is what assert-fomi-run.ts gates against
// in T-final-2 of this stream.
// ---------------------------------------------------------------------------

const FOMI_IDEA_TEXT =
  'AI-native focus app that monitors screens to keep users on-task. ' +
  'Detects when users drift off-task (social media, distracting sites), ' +
  'gently nudges back via interventions. Uses cloud screenshot analysis.';

const FOMI_AUDIENCE_DEFAULT = 'B2C';
const FOMI_BUILDER_DEFAULT = 'solo';

const DEFAULT_ENDPOINT = 'https://getvetoed.com/mcp';

// ---------------------------------------------------------------------------
// CLI parsing — small, dependency-free. Handles --help, --flag value, and
// returns a typed config object.
// ---------------------------------------------------------------------------

interface Config {
  endpoint: string;
  token: string;
  idea: string;
  audience: string | undefined;
  builder: string | undefined;
  out: string | undefined;
}

const USAGE = `
Usage: tsx scripts/run-fomi-via-https.ts [options]

Phase 03 T-final-3a HTTPS client. Fetches the validate_idea PROMPT from a
hosted ProductValidation MCP endpoint over Streamable HTTP with bearer-token
auth. The returned prompt text is the orchestration script a fresh LLM
session (Claude Desktop / Cursor / Claude Code) executes to perform the
12-tool Fomi calibration.

Options:
  --endpoint <url>     MCP HTTPS endpoint
                       (default: ${DEFAULT_ENDPOINT})
  --token <bearer>     Bearer token (pv_<...>). Required unless
                       VETOED_TEST_TOKEN is set in the environment.
  --idea <text>        Idea text. Default: the Fomi case used in Phase 01/02
                       calibration artifacts.
  --audience <kind>    B2B | B2C | B2B2C | dev_tools (default: ${FOMI_AUDIENCE_DEFAULT})
  --builder <kind>     solo | small_team | funded (default: ${FOMI_BUILDER_DEFAULT})
  --out <path>         Write rendered prompt to a file (default: stdout).
  --help, -h           Print this usage text and exit 0.

Exit codes:
  0    Success: prompt fetched and emitted.
  1    Usage error or unexpected failure.
  2    Network / connection failure (placeholder-smoke target).
  3    MCP-protocol error (e.g. server returned an MCP error result).
  4    Authentication failure (401 / WWW-Authenticate).
`.trim();

function parseArgs(argv: string[]): Config | { error: string } | { help: true } {
  let endpoint = DEFAULT_ENDPOINT;
  let token = process.env['VETOED_TEST_TOKEN'] ?? '';
  let idea = FOMI_IDEA_TEXT;
  let audience: string | undefined = FOMI_AUDIENCE_DEFAULT;
  let builder: string | undefined = FOMI_BUILDER_DEFAULT;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      return { help: true };
    }
    const next = argv[i + 1];
    switch (a) {
      case '--endpoint':
        if (!next) return { error: `--endpoint requires a value` };
        endpoint = next;
        i++;
        break;
      case '--token':
        if (!next) return { error: `--token requires a value` };
        token = next;
        i++;
        break;
      case '--idea':
        if (!next) return { error: `--idea requires a value` };
        idea = next;
        i++;
        break;
      case '--audience':
        if (!next) return { error: `--audience requires a value` };
        audience = next;
        i++;
        break;
      case '--builder':
        if (!next) return { error: `--builder requires a value` };
        builder = next;
        i++;
        break;
      case '--out':
        if (!next) return { error: `--out requires a value` };
        out = next;
        i++;
        break;
      default:
        if (a.startsWith('--')) {
          return { error: `Unknown flag: ${a}` };
        }
        // Positional args not used; if any appear, treat as user error.
        return { error: `Unexpected positional argument: ${a}` };
    }
  }

  if (!token) {
    return {
      error:
        'No token provided. Pass --token pv_<...> or set VETOED_TEST_TOKEN in the environment.',
    };
  }

  return { endpoint, token, idea, audience, builder, out };
}

// ---------------------------------------------------------------------------
// Connection-error classification — keeps placeholder-smoke output friendly
// (per PLAN.md T-final-3a C9 acceptance: NOT an unhandled rejection, NOT a
// crash; clear stderr message + non-zero exit code).
// ---------------------------------------------------------------------------

interface ClassifiedError {
  category: 'network' | 'auth' | 'mcp' | 'unknown';
  message: string;
  exitCode: number;
}

function classifyError(err: unknown): ClassifiedError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // Auth: the SDK surfaces 401s via UnauthorizedError / status code 401 in
  // StreamableHTTPError. Detect both shapes.
  if (
    lower.includes('unauthorized') ||
    lower.includes('401') ||
    lower.includes('www-authenticate')
  ) {
    return {
      category: 'auth',
      message: `Authentication failed: ${msg}`,
      exitCode: 4,
    };
  }

  // Network: connection refused, DNS failures, TLS handshake errors, fetch
  // failures. Node's undici surfaces these with various shapes; we match the
  // common substrings.
  if (
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('eai_again') ||
    lower.includes('ehostunreach') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('tls') ||
    lower.includes('certificate')
  ) {
    return {
      category: 'network',
      message: `Could not connect to MCP endpoint: ${msg}`,
      exitCode: 2,
    };
  }

  // MCP protocol error (e.g. server returns JSON-RPC error result).
  if (lower.includes('mcp') || lower.includes('jsonrpc') || lower.includes('json-rpc')) {
    return {
      category: 'mcp',
      message: `MCP protocol error: ${msg}`,
      exitCode: 3,
    };
  }

  return { category: 'unknown', message: msg, exitCode: 1 };
}

// ---------------------------------------------------------------------------
// Main flow.
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('help' in parsed) {
    console.log(USAGE);
    return 0;
  }
  if ('error' in parsed) {
    console.error(`error: ${parsed.error}\n`);
    console.error(USAGE);
    return 1;
  }

  const cfg = parsed;
  const endpointUrl = (() => {
    try {
      return new URL(cfg.endpoint);
    } catch {
      return null;
    }
  })();
  if (!endpointUrl) {
    console.error(`error: --endpoint is not a valid URL: ${cfg.endpoint}`);
    return 1;
  }

  console.error(`[run-fomi-via-https] endpoint=${cfg.endpoint}`);
  console.error(`[run-fomi-via-https] idea="${cfg.idea.slice(0, 80)}${cfg.idea.length > 80 ? '...' : ''}"`);
  console.error(`[run-fomi-via-https] audience=${cfg.audience ?? '(unset)'} builder=${cfg.builder ?? '(unset)'}`);
  console.error(`[run-fomi-via-https] out=${cfg.out ?? '(stdout)'}`);

  const transport = new StreamableHTTPClientTransport(endpointUrl, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${cfg.token}`,
      },
    },
  });

  const client = new Client({
    name: 'run-fomi-via-https',
    version: '0.1.0',
  });

  try {
    await client.connect(transport);

    // validate_idea is a PROMPT in this MCP — it is NOT a tool. The MCP wire
    // call is `prompts/get`; the LLM-side will then orchestrate the 12 tools.
    const promptArgs: Record<string, string> = { idea: cfg.idea };
    if (cfg.audience) promptArgs['audience'] = cfg.audience;
    if (cfg.builder) promptArgs['builder'] = cfg.builder;

    const promptResult = await client.getPrompt({
      name: 'validate_idea',
      arguments: promptArgs,
    });

    // Serialize: emit the description (if any) + every message's content as a
    // structured JSON payload, so a downstream LLM-driver can replay the
    // prompt verbatim. The MCP `prompts/get` response shape is:
    //   { description?: string, messages: [{ role, content: { type, text } }] }
    const out = {
      endpoint: cfg.endpoint,
      idea: cfg.idea,
      audience: cfg.audience ?? null,
      builder: cfg.builder ?? null,
      captured_at: new Date().toISOString(),
      description: promptResult.description ?? null,
      messages: promptResult.messages,
    };
    const serialized = JSON.stringify(out, null, 2);

    if (cfg.out) {
      writeFileSync(cfg.out, serialized + '\n', 'utf8');
      console.error(`[run-fomi-via-https] wrote ${serialized.length} bytes to ${cfg.out}`);
    } else {
      console.log(serialized);
    }

    await client.close();
    return 0;
  } catch (err) {
    // Best-effort close — never propagate close-time errors to the user.
    try {
      await client.close();
    } catch {
      /* swallow */
    }
    const classified = classifyError(err);
    console.error(`[run-fomi-via-https] ${classified.category}: ${classified.message}`);
    return classified.exitCode;
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    // Last-ditch safety net — any error that escapes `main()` should still
    // produce a friendly message rather than an unhandled-rejection trace
    // (per PLAN.md T-final-3a C9 acceptance).
    const classified = classifyError(err);
    console.error(`[run-fomi-via-https] fatal/${classified.category}: ${classified.message}`);
    process.exit(classified.exitCode === 0 ? 1 : classified.exitCode);
  });
