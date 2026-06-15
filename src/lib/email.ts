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

const SUBJECT = 'Welcome to Veto. Your access token is inside.';

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
  lines.push('      "command": "npx",');
  lines.push('      "args": [');
  lines.push('        "-y",');
  lines.push('        "mcp-remote",');
  lines.push('        "https://getvetoed.com/mcp",');
  lines.push('        "--header",');
  lines.push(`        "Authorization:Bearer ${token}"`);
  lines.push('      ]');
  lines.push('    }');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  lines.push('Restart Claude Desktop, then run "validate_idea" against your next idea.');
  lines.push('');
  lines.push('Docs and full setup: https://getvetoed.com/');
  lines.push('');
  lines.push("Questions or anything broken? Write to aljosa.sandbox@gmail.com. Happy to help.");
  lines.push("(This inbox doesn't accept replies. Please use the address above.)");
  lines.push('');
  lines.push('Aljosa');

  return lines.join('\n');
}

/**
 * Build the HTML body. Token appears both inside a <code> block AND as
 * plain text on the same line so accessibility tools that strip HTML
 * can still recover it.
 *
 * Phase 06 T13 restyle: BRAND.md tokens applied within the email-client-
 * safe subset (table-based layout, inline style attributes, web-safe font
 * fallbacks, hardcoded color values — no CSS custom properties because
 * email clients don't support them).
 */
export function buildHtmlBody(token: string, adminNote: string | null): string {
  const esc = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  // Hardcoded color values — email clients ignore CSS custom properties.
  // BRAND.md palette mapped:
  //   bg #111210, surface #1A1A18, text #F5F4F0, text-secondary
  //   rgba(245,244,240,0.55) ≈ #8A8985, text-tertiary
  //   rgba(245,244,240,0.30) ≈ #4D4C4A, accent #D4F233.
  // Email-safe font stacks: DM Mono primary with system mono fallback;
  // Inter primary with system sans fallback (so clients without Google
  // Fonts loaded still get a sensible monospace / sans-serif).

  const noteBlock =
    adminNote && adminNote.trim().length > 0
      ? `
                <tr>
                  <td style="padding:0 0 24px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#1A1A18;border:1px solid rgba(255,184,40,0.30);border-radius:2px;">
                      <tr>
                        <td style="padding:14px 18px;color:#F5F4F0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;">
                          <div style="font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.10em;text-transform:uppercase;color:#FFB828;margin:0 0 6px;">A quick note from the team</div>
                          ${esc(adminNote.trim()).replace(/\n/g, '<br>')}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
`
      : '';

  // Claude Desktop today does not natively accept the streamable-HTTP MCP
  // shape ({ url, headers }) — it rejects such entries as "not a valid MCP
  // server configuration". Use the `mcp-remote` stdio shim instead. See
  // docs/HOSTED_SETUP.md §2.
  const configJson = `{
  "mcpServers": {
    "veto": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://getvetoed.com/mcp",
        "--header",
        "Authorization:Bearer ${esc(token)}"
      ]
    }
  }
}`;

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#111210;color:#F5F4F0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#111210;">
    <tr>
      <td align="center" style="padding:32px 16px 64px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#111210;">
          <tr>
            <td style="padding:0 0 32px;border-bottom:1px solid rgba(245,244,240,0.10);">
              <span style="font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:500;font-size:16px;letter-spacing:-0.02em;text-transform:uppercase;color:#F5F4F0;">VETO</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 0 16px;">${noteBlock}
              <div style="font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.10em;text-transform:uppercase;color:rgba(245,244,240,0.55);margin:0 0 12px;">Access granted</div>
              <h1 style="font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:500;font-size:28px;letter-spacing:-0.02em;line-height:1.1;color:#F5F4F0;margin:0 0 16px;">You're in. Welcome to Veto.</h1>
              <p style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:rgba(245,244,240,0.55);margin:0 0 24px;">Your bearer token is below. Paste it into your client config and run validate_idea against your next idea.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 24px;">
              <div style="font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.10em;text-transform:uppercase;color:rgba(245,244,240,0.55);margin:0 0 8px;">Your access token</div>
              <code style="display:block;background:#1A1A18;border:1px solid rgba(245,244,240,0.10);padding:14px 16px;border-radius:2px;font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;color:#F5F4F0;word-break:break-all;">${esc(token)}</code>
              <p style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:rgba(245,244,240,0.30);margin:8px 0 0;">Token (plain text, for accessibility): ${esc(token)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0 24px;">
              <div style="font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.10em;text-transform:uppercase;color:rgba(245,244,240,0.55);margin:0 0 8px;">Add this to your Claude Desktop config</div>
              <p style="font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:rgba(245,244,240,0.55);margin:0 0 6px;">macOS: <code style="color:#F5F4F0;">~/Library/Application Support/Claude/claude_desktop_config.json</code></p>
              <p style="font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:rgba(245,244,240,0.55);margin:0 0 12px;">Windows: <code style="color:#F5F4F0;">%APPDATA%\\Claude\\claude_desktop_config.json</code></p>
              <pre style="background:#1A1A18;border:1px solid rgba(245,244,240,0.10);padding:14px 16px;border-radius:2px;font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:#F5F4F0;line-height:1.5;overflow-x:auto;margin:0;white-space:pre;">${esc(configJson)}</pre>
              <p style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:rgba(245,244,240,0.55);margin:16px 0 0;">Restart Claude Desktop, then run <code style="font-family:'DM Mono',ui-monospace,monospace;color:#F5F4F0;">validate_idea</code> against your next idea. Cursor, Codex CLI, and other clients use the same MCP URL with their own config shape. See the install section on getvetoed.com.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0 24px;">
              <a href="https://getvetoed.com/#install" style="display:inline-block;background:#D4F233;color:#111210;font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:500;letter-spacing:0.04em;text-transform:uppercase;padding:10px 20px;border-radius:2px;text-decoration:none;">Install docs</a>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 0 16px;border-top:1px solid rgba(245,244,240,0.10);">
              <p style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:rgba(245,244,240,0.55);margin:0 0 8px;">Questions or anything broken? Write to <a href="mailto:aljosa.sandbox@gmail.com" style="color:#F5F4F0;text-decoration:underline;">aljosa.sandbox@gmail.com</a> . Happy to help.</p>
              <p style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:rgba(245,244,240,0.30);margin:0 0 16px;">(This inbox doesn't accept replies. Please use the address above.)</p>
              <p style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:rgba(245,244,240,0.55);margin:0;">Aljosa</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
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
    'Veto'
  );
}

/**
 * Build the HTML body for the magic link email. Mirrors the approval
 * email's BRAND.md application: table-based layout, inline styles only,
 * web-safe font-family fallbacks, hardcoded color values (no CSS
 * custom properties — email clients don't support them).
 *
 * Phase 06 T14 restyle: BRAND.md tokens applied within email-safe HTML.
 * The CTA button is the magic link itself in primary CTA shape
 * (#D4F233 background, #111210 text, DM Mono 13/500 0.04em uppercase).
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
<html><body style="margin:0;padding:0;background:#111210;color:#F5F4F0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#111210;">
    <tr>
      <td align="center" style="padding:32px 16px 64px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#111210;">
          <tr>
            <td style="padding:0 0 32px;border-bottom:1px solid rgba(245,244,240,0.10);">
              <span style="font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:500;font-size:16px;letter-spacing:-0.02em;text-transform:uppercase;color:#F5F4F0;">VETO</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 0 16px;">
              <div style="font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.10em;text-transform:uppercase;color:rgba(245,244,240,0.55);margin:0 0 12px;">Sign in</div>
              <h1 style="font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:500;font-size:28px;letter-spacing:-0.02em;line-height:1.1;color:#F5F4F0;margin:0 0 16px;">One click to your token.</h1>
              <p style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:rgba(245,244,240,0.55);margin:0 0 24px;">You're one click away from your Veto access token.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0 32px;">
              <a href="${safeUrl}" style="display:inline-block;background:#D4F233;color:#111210;font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:500;letter-spacing:0.04em;text-transform:uppercase;padding:12px 24px;border-radius:2px;text-decoration:none;">Sign in to Veto</a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 24px;">
              <p style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:rgba(245,244,240,0.55);margin:0 0 6px;">Or paste this URL into your browser:</p>
              <a href="${safeUrl}" style="font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:#F5F4F0;word-break:break-all;text-decoration:underline;">${safeUrl}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0 16px;">
              <p style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:rgba(245,244,240,0.55);margin:0;">This link expires in 15 minutes and works once. If you didn't request this, you can safely ignore the email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 0 16px;border-top:1px solid rgba(245,244,240,0.10);">
              <p style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:rgba(245,244,240,0.55);margin:0 0 8px;">Questions? Write to <a href="mailto:aljosa.sandbox@gmail.com" style="color:#F5F4F0;text-decoration:underline;">aljosa.sandbox@gmail.com</a>.</p>
              <p style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:rgba(245,244,240,0.30);margin:0 0 16px;">(This inbox doesn't accept replies. Please use the address above.)</p>
              <p style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:rgba(245,244,240,0.55);margin:0;">Veto</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
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
