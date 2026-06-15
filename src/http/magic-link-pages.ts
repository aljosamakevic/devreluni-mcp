// Phase 06 T11/T12 — Server-side rendered HTML for the magic-link verify
// endpoint. Restyled to BRAND.md tokens (dark theme, DM Mono wordmark +
// labels, Inter body, --accent CTA, --status-fail rails on errors).
// Functional shape preserved from Phase 05a:
//
//   1. Success page — shown when a fresh, unused, unexpired magic-link
//      token is consumed. Displays the freshly minted bearer token with
//      a "Copy token" button and the copy-paste Claude Desktop config
//      snippet pre-filled with that token.
//
//   2. Error page — shown when the token is missing, not-found, expired,
//      or already-used. Tells the user which kind of failure it was and
//      links back to https://getvetoed.com/ to request a new sign-in
//      link. No decorative icons (BRAND.md "No decorative elements").
//
// Per BRAND.md "Email clients have wildly varying CSS support" doesn't
// apply here — these are HTTP responses rendered in a real browser, so
// we can use CSS custom properties + flex/grid freely.
//
// escapeHtml() defensive depth. Bearer tokens are base64url so the
// escape is a no-op in practice, but cheap to be paranoid.

export type MagicLinkErrorReason =
  | 'missing_token'
  | 'not_found'
  | 'expired'
  | 'already_used';

const ERROR_COPY: Record<
  MagicLinkErrorReason,
  { title: string; headline: string; body: string; badge: string }
> = {
  missing_token: {
    title: "Sign-in link missing token | Veto",
    headline: "That link is missing its token.",
    body: "We couldn't find a token in the URL. Request a new sign-in link and try again.",
    badge: 'MISSING TOKEN',
  },
  not_found: {
    title: "Sign-in link not found | Veto",
    headline: "We couldn't find that link.",
    body: "This link doesn't match any sign-in request. It may have been mistyped or already expired. Request a new one and try again.",
    badge: 'NOT FOUND',
  },
  expired: {
    title: "Sign-in link expired | Veto",
    headline: "This link has expired.",
    body: "Sign-in links work for 15 minutes. Request a new one and try again.",
    badge: 'EXPIRED',
  },
  already_used: {
    title: "Sign-in link already used | Veto",
    headline: "This link has already been used.",
    body: "Each sign-in link only works once. If you already have your token, you're set. Otherwise, request a new sign-in link.",
    badge: 'ALREADY USED',
  },
};

/**
 * Shared <head> block — Google Fonts (DM Mono + Inter) + BRAND.md tokens
 * + reset. Used by both the success and error pages.
 */
const SHARED_STYLE = `
  :root {
    --bg: #111210;
    --surface: #1A1A18;
    --border: rgba(245, 244, 240, 0.10);
    --border-emphasis: rgba(245, 244, 240, 0.20);
    --text: #F5F4F0;
    --text-secondary: rgba(245, 244, 240, 0.55);
    --text-tertiary: rgba(245, 244, 240, 0.30);
    --accent: #D4F233;
    --status-fail: #FF6B55;
    --status-fail-bg: rgba(255, 107, 85, 0.10);
    --radius: 2px;
    --font-mono: "DM Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --font-body: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    --max: 720px;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); }
  body {
    color: var(--text);
    font-family: var(--font-body);
    font-size: 16px;
    line-height: 1.65;
    letter-spacing: -0.01em;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    padding: 48px 24px 96px;
  }
  ::selection { background: var(--accent); color: var(--bg); }
  a { color: inherit; text-decoration: none; }
  a:focus-visible, button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  main { max-width: var(--max); margin: 0 auto; }
  .wordmark {
    font-family: var(--font-mono);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: -0.02em;
    font-size: 16px;
    color: var(--text);
    display: inline-block;
    margin-bottom: 48px;
  }
  .eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.10em;
    color: var(--text-tertiary);
    margin: 0 0 16px;
  }
  h1 {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: 32px;
    letter-spacing: -0.02em;
    line-height: 1.15;
    margin: 0 0 16px;
    color: var(--text);
  }
  h2 {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: 18px;
    letter-spacing: -0.01em;
    margin: 32px 0 12px;
    color: var(--text);
  }
  p { margin: 0 0 14px; color: var(--text-secondary); }
  p.lede { color: var(--text); font-size: 18px; line-height: 1.4; margin: 0 0 24px; }
  code, pre { font-family: var(--font-mono); }
  code.token {
    display: block;
    background: var(--surface);
    border: 0.5px solid var(--border);
    padding: 14px 16px;
    border-radius: var(--radius);
    font-size: 14px;
    color: var(--text);
    word-break: break-all;
    margin: 8px 0 12px;
  }
  pre.config {
    background: var(--surface);
    border: 0.5px solid var(--border);
    padding: 14px 16px;
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--text);
    line-height: 1.5;
    overflow-x: auto;
    margin: 8px 0 18px;
    white-space: pre;
  }
  button.copy {
    padding: 10px 20px;
    background: var(--accent);
    color: var(--bg);
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
    transition: opacity 120ms ease;
  }
  button.copy:hover { opacity: 0.88; }
  button.copy:disabled { opacity: 0.4; cursor: default; }
  a.cta {
    display: inline-block;
    margin: 8px 0;
    padding: 10px 20px;
    background: var(--accent);
    color: var(--bg);
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border-radius: var(--radius);
  }
  a.cta:hover { opacity: 0.88; }
  .copied {
    margin-left: 12px;
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent);
    display: inline-block;
    vertical-align: middle;
  }
  .path {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-tertiary);
    margin: 0 0 8px;
  }
  .status-badge {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    background: var(--status-fail-bg);
    color: var(--status-fail);
    border: 0.5px solid var(--status-fail);
    border-radius: 1px;
    padding: 4px 10px;
    margin-bottom: 16px;
  }
  footer {
    margin-top: 64px;
    padding-top: 24px;
    border-top: 0.5px solid var(--border);
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
  }
  footer a { color: var(--text-secondary); }
  footer a:hover { color: var(--text); }
`;

const FONT_LINKS = `
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@400;500&display=swap">`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render the success page shown right after a magic link is consumed.
 * Embeds the freshly minted bearer token + a pre-filled Claude Desktop
 * config snippet. The "Copy token" button uses navigator.clipboard with
 * document.execCommand fallback (same pattern as the landing page).
 */
export function renderMagicLinkSuccessPage(bearerToken: string): string {
  const safeToken = escapeHtml(bearerToken);
  // Claude Desktop does not yet support the native streamable-HTTP MCP
  // shape ({ url, headers }) — entries in that shape are silently rejected
  // as "not a valid MCP server configuration". The community-standard fix
  // is the `mcp-remote` stdio shim: a tiny npx-launched bridge that speaks
  // stdio to Claude Desktop and Streamable HTTP to our server. See
  // docs/HOSTED_SETUP.md §2 for the full rationale.
  const configJson = `{
  "mcpServers": {
    "veto": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://getvetoed.com/mcp",
        "--header",
        "Authorization:Bearer ${bearerToken}"
      ]
    }
  }
}`;
  const safeConfig = escapeHtml(configJson);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>You're in | Veto</title>
    <meta name="robots" content="noindex,nofollow">${FONT_LINKS}
    <style>${SHARED_STYLE}</style>
  </head>
  <body>
    <main>
      <span class="wordmark" aria-label="Veto">VETO</span>

      <p class="eyebrow">Access granted</p>
      <h1>You're in.</h1>
      <p class="lede">Your bearer token is below. Paste it into your client config and run validate_idea against your next idea.</p>

      <h2>Your access token</h2>
      <code class="token" id="bearer-token">${safeToken}</code>
      <div>
        <button class="copy" id="copy-btn" type="button">Copy token</button>
        <span class="copied" id="copied-msg" aria-live="polite"></span>
      </div>

      <h2>Add this to your Claude Desktop config</h2>
      <p class="path">macOS: <code>~/Library/Application Support/Claude/claude_desktop_config.json</code></p>
      <p class="path">Windows: <code>%APPDATA%\\Claude\\claude_desktop_config.json</code></p>
      <pre class="config">${safeConfig}</pre>
      <p>Restart Claude Desktop, then run <code>validate_idea</code>. Cursor, Codex CLI, and other clients use the same MCP URL with their own config shape. See <a href="https://getvetoed.com/#install" style="color: var(--accent); border-bottom: 0.5px solid var(--accent);">the install section</a> on getvetoed.com.</p>

      <footer>
        <a href="https://getvetoed.com/">Back to getvetoed.com</a>
      </footer>
    </main>
    <script>
      (function () {
        'use strict';
        var btn = document.getElementById('copy-btn');
        var tokenEl = document.getElementById('bearer-token');
        var msg = document.getElementById('copied-msg');
        if (!btn || !tokenEl || !msg) return;
        btn.addEventListener('click', function () {
          var token = tokenEl.textContent || '';
          var done = function () {
            msg.textContent = 'Copied';
            setTimeout(function () { msg.textContent = ''; }, 2200);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(token).then(done, function () {
              msg.textContent = 'Copy failed. Select and copy manually.';
            });
          } else {
            var range = document.createRange();
            range.selectNode(tokenEl);
            var sel = window.getSelection();
            if (sel) { sel.removeAllRanges(); sel.addRange(range); }
            try { document.execCommand('copy'); done(); }
            catch (e) { msg.textContent = 'Copy failed. Select and copy manually.'; }
          }
        });
      })();
    </script>
  </body>
</html>`;
}

/**
 * Render the error page shown when the magic link is missing/expired/used/
 * not-found. Single status badge in --status-fail (semantic red, BRAND.md
 * "No decorative elements" rule honored).
 */
export function renderMagicLinkErrorPage(reason: MagicLinkErrorReason): string {
  const copy = ERROR_COPY[reason];
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(copy.title)}</title>
    <meta name="robots" content="noindex,nofollow">${FONT_LINKS}
    <style>${SHARED_STYLE}</style>
  </head>
  <body>
    <main>
      <span class="wordmark" aria-label="Veto">VETO</span>

      <span class="status-badge">${escapeHtml(copy.badge)}</span>
      <h1>${escapeHtml(copy.headline)}</h1>
      <p class="lede">${escapeHtml(copy.body)}</p>

      <p><a class="cta" href="https://getvetoed.com/">Request a new sign-in link</a></p>

      <footer>
        <a href="https://getvetoed.com/">Back to getvetoed.com</a>
      </footer>
    </main>
  </body>
</html>`;
}
