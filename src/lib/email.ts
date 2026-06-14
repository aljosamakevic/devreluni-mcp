// Phase 04 D-03-5 — Resend email integration.
//
// One public function: sendApprovalEmail. Called by the admin API when an
// approval flips the DB to status='approved'. Subject + body match the spec
// in the phase prompt:
//   - Subject: "Welcome to Veto — your access token is inside"
//   - Body: optional admin-note block, then standard template (token in
//     monospace block + plaintext, copy-paste Claude Desktop config snippet
//     for https://getvetoed.com/mcp, link to https://getvetoed.com/,
//     friendly closing).
//   - Both HTML and plain-text bodies are sent; the token appears in BOTH
//     so accessibility tools that strip HTML still surface it.
//
// Module-load snapshot of env vars (RESEND_API_KEY + RESEND_FROM) mirrors the
// logger.ts pattern. If RESEND_API_KEY is missing at module load, the client
// is constructed lazily as null and sendApprovalEmail returns
// { ok: false, error: 'email_disabled' } without attempting the call.
// This is intentional fail-soft: the admin API still flips the DB and
// surfaces the error in the response so the operator can copy the token
// from the DB manually.
//
// SDK verified: resend@6.12.4. emails.send returns { data, error } where
// `data: { id: string }` on success and `error: { name: string, message: string }`
// on failure (the SDK does NOT throw on API errors — errors are returned
// as part of the result object). See node_modules/resend/dist/index.d.ts.

import { Resend } from 'resend';
import { logger } from './logger.js';

const DEFAULT_FROM = 'Veto <noreply@getvetoed.com>';
const SEND_TIMEOUT_MS = 10_000;

const RESEND_API_KEY = process.env['RESEND_API_KEY'] ?? '';
const RESEND_FROM = process.env['RESEND_FROM'] ?? DEFAULT_FROM;

// Lazy-but-snapshotted: construct the client at module load if we have a key.
// If the key is unset/empty, leave `client` null so sendApprovalEmail short-
// circuits to email_disabled without hitting the network.
let client: Resend | null = null;
if (RESEND_API_KEY.length > 0) {
  client = new Resend(RESEND_API_KEY);
} else {
  logger.warn(
    { event: 'resend_disabled', reason: 'RESEND_API_KEY missing at module load' },
    'Resend client disabled — sendApprovalEmail will return email_disabled'
  );
}

export interface SendApprovalEmailInput {
  to: string;
  token: string;
  adminNote?: string | null;
}

export type SendApprovalEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const SUBJECT = 'Welcome to Veto — your access token is inside';

/**
 * Build the plain-text body. Token appears verbatim so screen readers and
 * plain-text mail clients (Mutt, terminal previewers) can copy it.
 */
export function buildTextBody(token: string, adminNote: string | null): string {
  const lines: string[] = [];

  if (adminNote && adminNote.trim().length > 0) {
    lines.push('A quick note from the team:');
    lines.push('');
    lines.push(adminNote.trim());
    lines.push('');
    lines.push('--');
    lines.push('');
  }

  lines.push("You're in. Welcome to Veto.");
  lines.push('');
  lines.push('Your access token:');
  lines.push('');
  lines.push(`    ${token}`);
  lines.push('');
  lines.push('Add this to your Claude Desktop config');
  lines.push('(~/Library/Application Support/Claude/claude_desktop_config.json on macOS,');
  lines.push(' %APPDATA%\\Claude\\claude_desktop_config.json on Windows):');
  lines.push('');
  lines.push('{');
  lines.push('  "mcpServers": {');
  lines.push('    "veto": {');
  lines.push('      "url": "https://getvetoed.com/mcp",');
  lines.push('      "headers": {');
  lines.push(`        "Authorization": "Bearer ${token}"`);
  lines.push('      }');
  lines.push('    }');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  lines.push('Restart Claude Desktop, then run "validate_idea" against your next idea.');
  lines.push('');
  lines.push('Docs and full setup: https://getvetoed.com/');
  lines.push('');
  lines.push("Questions or anything broken? Write to aljosa.sandbox@gmail.com — happy to help.");
  lines.push("(This inbox doesn't accept replies — please use the address above.)");
  lines.push('');
  lines.push('— Aljosa');

  return lines.join('\n');
}

/**
 * Build the HTML body. Token appears both inside a <code> block AND as
 * plain text on the same line so accessibility tools that strip HTML
 * can still recover it.
 */
export function buildHtmlBody(token: string, adminNote: string | null): string {
  const esc = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const noteBlock =
    adminNote && adminNote.trim().length > 0
      ? `
    <div style="background:#fffbe6;border:1px solid #f0e3a3;border-radius:4px;padding:12px 16px;margin:0 0 24px;color:#5a4a10;">
      <strong>A quick note from the team:</strong><br>
      ${esc(adminNote.trim()).replace(/\n/g, '<br>')}
    </div>
`
      : '';

  const configJson = `{
  "mcpServers": {
    "veto": {
      "url": "https://getvetoed.com/mcp",
      "headers": {
        "Authorization": "Bearer ${esc(token)}"
      }
    }
  }
}`;

  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px;">
${noteBlock}
    <p>You're in. Welcome to Veto.</p>

    <p>Your access token:</p>

    <p><code style="display:block;background:#efece4;padding:12px 14px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;word-break:break-all;">${esc(token)}</code></p>

    <p>Token (plain text, for accessibility): ${esc(token)}</p>

    <p>Add this to your Claude Desktop config (<code>~/Library/Application Support/Claude/claude_desktop_config.json</code> on macOS, <code>%APPDATA%\\Claude\\claude_desktop_config.json</code> on Windows):</p>

    <pre style="background:#efece4;padding:14px 16px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;overflow-x:auto;">${esc(configJson)}</pre>

    <p>Restart Claude Desktop, then run <code>validate_idea</code> against your next idea.</p>

    <p>Docs and full setup: <a href="https://getvetoed.com/">https://getvetoed.com/</a></p>

    <p>Questions or anything broken? Write to <a href="mailto:aljosa.sandbox@gmail.com">aljosa.sandbox@gmail.com</a> — happy to help.</p>
    <p style="font-size:13px;color:#777;">(This inbox doesn't accept replies — please use the address above.)</p>

    <p>— Aljosa</p>
</body></html>`;
}

/**
 * Send the welcome email containing the freshly-issued token.
 *
 * Fail-soft semantics:
 *   - If RESEND_API_KEY was unset at module load → { ok: false, error: 'email_disabled' }
 *   - If the API call throws or returns an error → { ok: false, error: <reason> }
 *   - If the 10s timeout fires → { ok: false, error: 'timeout' }
 *
 * NEVER throws — the admin API needs to surface the error to the dashboard.
 */
export async function sendApprovalEmail(
  input: SendApprovalEmailInput
): Promise<SendApprovalEmailResult> {
  if (!client) {
    return { ok: false, error: 'email_disabled' };
  }

  if (typeof input.to !== 'string' || input.to.trim().length === 0) {
    return { ok: false, error: 'invalid_to' };
  }
  if (typeof input.token !== 'string' || input.token.length === 0) {
    return { ok: false, error: 'invalid_token' };
  }

  const adminNote = input.adminNote ?? null;
  const html = buildHtmlBody(input.token, adminNote);
  const text = buildTextBody(input.token, adminNote);

  // Race the API call against a 10s timeout. The Resend SDK does not expose
  // its own timeout option as of 6.12.4, so Promise.race is the cleanest path.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SendApprovalEmailResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), SEND_TIMEOUT_MS);
  });

  try {
    const sendPromise = client.emails
      .send({
        from: RESEND_FROM,
        to: [input.to],
        subject: SUBJECT,
        html,
        text,
      })
      .then((result): SendApprovalEmailResult => {
        if (result.error) {
          return {
            ok: false,
            error: result.error.message || result.error.name || 'resend_error',
          };
        }
        if (!result.data?.id) {
          return { ok: false, error: 'no_message_id' };
        }
        return { ok: true, id: result.data.id };
      })
      .catch((err: unknown): SendApprovalEmailResult => {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      });

    return await Promise.race([sendPromise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Test seam — rebuild the client from the current env vars. Used only by
// src/lib/email.test.ts to flip RESEND_API_KEY between cases.
export function __reloadEmailClientForTests(): void {
  const key = process.env['RESEND_API_KEY'] ?? '';
  if (key.length > 0) {
    client = new Resend(key);
  } else {
    client = null;
  }
}

// Constants exported for tests + downstream wiring.
export const APPROVAL_EMAIL_SUBJECT = SUBJECT;
export const APPROVAL_EMAIL_FROM = RESEND_FROM;

// ---------------------------------------------------------------------------
// Phase 05a D-03-5 — Magic link email.
//
// Called by the POST /auth/magic-link/request handler with the verify URL
// already constructed by the caller. We embed the URL verbatim into both
// the plain-text and HTML bodies so terminal mail clients can still copy it.
//
// Same fail-soft semantics as sendApprovalEmail:
//   - email_disabled when RESEND_API_KEY was unset at module load
//   - timeout after SEND_TIMEOUT_MS
//   - never throws
// ---------------------------------------------------------------------------

const MAGIC_LINK_SUBJECT = 'Your Veto sign-in link';

export interface SendMagicLinkEmailInput {
  to: string;
  url: string;
}

export type SendMagicLinkEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Build the plain-text body for the magic link email. URL appears verbatim
 * so plain-text mail clients can copy it without HTML parsing.
 */
export function buildMagicLinkTextBody(url: string): string {
  return (
    "You're one click away from your Veto access token.\n" +
    '\n' +
    'Sign in to claim your token:\n' +
    '\n' +
    `    ${url}\n` +
    '\n' +
    "This link expires in 15 minutes and works once. If you didn't request this, you can safely ignore the email.\n" +
    '\n' +
    'Questions? Write to aljosa.sandbox@gmail.com (this inbox does not accept replies).\n' +
    '\n' +
    '— Veto'
  );
}

/**
 * Build the HTML body for the magic link email. Mirrors the approval email
 * wrapper (system font stack, --bg/--fg palette) so both feel like the
 * same product. The CTA is a button-styled <a> using the landing accent.
 */
export function buildMagicLinkHtmlBody(url: string): string {
  const esc = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const safeUrl = esc(url);
  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px;">
    <p>You're one click away from your Veto access token.</p>

    <p>Sign in to claim your token:</p>

    <p style="margin:24px 0;">
      <a href="${safeUrl}" style="display:inline-block;padding:12px 22px;background:#c0392b;color:#fff;font-weight:600;text-decoration:none;border-radius:4px;">Sign in to Veto</a>
    </p>

    <p style="font-size:14px;color:#555;">Or paste this URL into your browser:<br>
    <a href="${safeUrl}" style="color:#555;word-break:break-all;">${safeUrl}</a></p>

    <p style="font-size:14px;color:#555;">This link expires in 15 minutes and works once. If you didn't request this, you can safely ignore the email.</p>

    <p style="font-size:13px;color:#777;">Questions? Write to <a href="mailto:aljosa.sandbox@gmail.com" style="color:#777;">aljosa.sandbox@gmail.com</a> (this inbox does not accept replies).</p>

    <p>— Veto</p>
</body></html>`;
}

/**
 * Send the magic-link email. URL is embedded verbatim into both bodies.
 * Fail-soft (never throws); caller (POST /auth/magic-link/request handler)
 * always returns the same success body to the client regardless of result
 * so we don't leak whether the email actually went out.
 */
export async function sendMagicLinkEmail(
  input: SendMagicLinkEmailInput
): Promise<SendMagicLinkEmailResult> {
  if (!client) {
    return { ok: false, error: 'email_disabled' };
  }

  if (typeof input.to !== 'string' || input.to.trim().length === 0) {
    return { ok: false, error: 'invalid_to' };
  }
  if (typeof input.url !== 'string' || input.url.length === 0) {
    return { ok: false, error: 'invalid_url' };
  }

  const html = buildMagicLinkHtmlBody(input.url);
  const text = buildMagicLinkTextBody(input.url);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SendMagicLinkEmailResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), SEND_TIMEOUT_MS);
  });

  try {
    const sendPromise = client.emails
      .send({
        from: RESEND_FROM,
        to: [input.to],
        subject: MAGIC_LINK_SUBJECT,
        html,
        text,
      })
      .then((result): SendMagicLinkEmailResult => {
        if (result.error) {
          return {
            ok: false,
            error: result.error.message || result.error.name || 'resend_error',
          };
        }
        if (!result.data?.id) {
          return { ok: false, error: 'no_message_id' };
        }
        return { ok: true, id: result.data.id };
      })
      .catch((err: unknown): SendMagicLinkEmailResult => {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      });

    return await Promise.race([sendPromise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const MAGIC_LINK_EMAIL_SUBJECT = MAGIC_LINK_SUBJECT;
export const MAGIC_LINK_EMAIL_FROM = RESEND_FROM;
