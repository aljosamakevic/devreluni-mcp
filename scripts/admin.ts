#!/usr/bin/env tsx
/**
 * Phase 03 T09 — Admin CLI.
 *
 * Subcommands:
 *   issue-token --email=<email>     -> mints + prints the plaintext token ONCE.
 *   list-tokens                     -> fixed-width table; prefix only.
 *   revoke-token <id-or-prefix>     -> marks token revoked.
 *
 * Runs locally against the dev SQLite (`./vetoed.db` fallback in
 * src/db/connection.ts) or inside the production container via
 * `flyctl ssh console -a vetoed-mcp` + `npm run admin -- <sub>`.
 *
 * Token plaintext is shown EXACTLY ONCE in `issue-token` output. After
 * that, only the 7-char prefix is ever displayed (CONTEXT.md decision 1
 * + D-03-2). NEVER log plaintext.
 */

import { issueToken, listTokens, revokeToken } from '../src/auth/tokens.js';

interface ParsedArgs {
  subcommand: string;
  flags: Record<string, string>;
  positionals: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const [subcommand, ...rest] = argv;
  const flags: Record<string, string> = {};
  const positionals: string[] = [];
  for (const arg of rest) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        flags[arg.slice(2)] = 'true';
      }
    } else {
      positionals.push(arg);
    }
  }
  return { subcommand: subcommand ?? '', flags, positionals };
}

function usage(): string {
  return [
    'Usage:',
    '  npm run admin -- issue-token --email=<email>',
    '  npm run admin -- list-tokens',
    '  npm run admin -- revoke-token <id-or-prefix>',
  ].join('\n');
}

function isValidEmail(email: string): boolean {
  // Minimal sanity check — non-empty, single '@', non-empty local + domain
  // with a '.' in the domain. The CLI is admin-only so we don't need RFC
  // 5322; we only need to reject empty/garbage at the shell.
  if (!email || email.length > 254) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const domain = email.slice(at + 1);
  if (domain.length === 0 || !domain.includes('.')) return false;
  return true;
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + ' '.repeat(width - value.length);
}

function cmdIssueToken(flags: Record<string, string>): number {
  const email = flags['email']?.trim() ?? '';
  if (!isValidEmail(email)) {
    process.stderr.write('issue-token: --email=<valid-email> is required\n');
    return 1;
  }
  const issued = issueToken(email);
  // SECURITY: this is the ONE place plaintext is ever printed.
  process.stdout.write(`token: ${issued.token}\n`);
  process.stdout.write(`id:     ${issued.id}\n`);
  process.stdout.write(`prefix: ${issued.prefix}\n`);
  process.stdout.write(
    'Save the token now. It will NOT be retrievable again — only the prefix is stored.\n'
  );
  return 0;
}

function cmdListTokens(): number {
  const rows = listTokens();
  // Column widths chosen to fit the longest typical email + ISO timestamps.
  const cols = [
    { label: 'id', width: 4 },
    { label: 'prefix', width: 8 },
    { label: 'email', width: 32 },
    { label: 'created_at', width: 26 },
    { label: 'last_used', width: 26 },
    { label: 'status', width: 8 },
  ] as const;
  const header = cols.map((c) => pad(c.label, c.width)).join(' | ');
  const sep = cols.map((c) => '-'.repeat(c.width)).join('-+-');
  process.stdout.write(header + '\n');
  process.stdout.write(sep + '\n');
  for (const row of rows) {
    const values: Record<(typeof cols)[number]['label'], string> = {
      id: String(row.id),
      prefix: row.prefix,
      email: row.email,
      created_at: row.created_at,
      last_used: row.last_used_at ?? '-',
      status: row.status,
    };
    process.stdout.write(
      cols.map((c) => pad(values[c.label], c.width)).join(' | ') + '\n'
    );
  }
  return 0;
}

function cmdRevokeToken(positionals: string[]): number {
  const target = positionals[0];
  if (!target) {
    process.stderr.write('revoke-token: <id-or-prefix> is required\n');
    return 1;
  }
  const idOrPrefix: string | number = /^\d+$/.test(target) ? Number(target) : target;
  const ok = revokeToken(idOrPrefix);
  if (!ok) {
    process.stderr.write('no match\n');
    return 1;
  }
  process.stdout.write(`revoked id=${typeof idOrPrefix === 'number' ? idOrPrefix : target}\n`);
  return 0;
}

function main(): number {
  const { subcommand, flags, positionals } = parseArgs(process.argv.slice(2));
  switch (subcommand) {
    case 'issue-token':
      return cmdIssueToken(flags);
    case 'list-tokens':
      return cmdListTokens();
    case 'revoke-token':
      return cmdRevokeToken(positionals);
    case '':
    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(usage() + '\n');
      return 0;
    default:
      process.stderr.write(`unknown subcommand: ${subcommand}\n`);
      process.stderr.write(usage() + '\n');
      return 1;
  }
}

process.exit(main());
