// Phase 05a D-03-5 — Server-side rendered HTML for the magic-link verify
// endpoint. Two pages live here, both returned as Content-Type: text/html
// from GET /auth/magic-link/verify.
//
//   1. Success page — shown when a fresh, unused, unexpired magic-link
//      token is consumed. Displays the freshly minted bearer token with
//      a "Copy token" button and the copy-paste Claude Desktop config
//      snippet pre-filled with that token. Matches the landing page
//      palette (--fg #1a1a1a, --bg #fafaf7, --accent #c0392b).
//
//   2. Error page — shown when the token is missing, not-found, expired,
//      or already-used. Tells the user which kind of failure it was and
//      links back to https://getvetoed.com/ to request a new sign-in
//      link.
//
// Both pages inline their CSS + JS so we don't add new public assets and
// can keep operating under the existing express.static('public') chain.
//
// escapeHtml(): defensive depth. Bearer tokens are base64url (safe) and
// the error reasons are static strings, but cheap to be paranoid.

export type MagicLinkErrorReason =
  | 'missing_token'
  | 'not_found'
  | 'expired'
  | 'already_used';

const ERROR_COPY: Record<
  MagicLinkErrorReason,
  { title: string; headline: string; body: string }
> = {
  missing_token: {
    title: "Sign-in link missing token — Veto",
    headline: "That link is missing its token.",
    body: "We couldn't find a token in the URL. Request a new sign-in link and try again.",
  },
  not_found: {
    title: "Sign-in link not found — Veto",
    headline: "We couldn't find that link.",
    body: "This link doesn't match any sign-in request. It may have been mistyped or already expired. Request a new one and try again.",
  },
  expired: {
    title: "Sign-in link expired — Veto",
    headline: "This link has expired.",
    body: "Sign-in links work for 15 minutes. Request a new one and try again.",
  },
  already_used: {
    title: "Sign-in link already used — Veto",
    headline: "This link has already been used.",
    body: "Each sign-in link only works once. If you already have your token, you're set. Otherwise, request a new sign-in link.",
  },
};

/** Inline CSS shared by both pages — mirrors the landing palette. */
const SHARED_STYLE = `
  :root {
    --fg: #1a1a1a;
    --muted: #555;
    --bg: #fafaf7;
    --accent: #c0392b;
    --rule: #e5e5e0;
    --code-bg: #efece4;
    --max: 720px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 17px;
    line-height: 1.6;
    color: var(--fg);
    background: var(--bg);
    padding: 48px 24px 96px;
  }
  main { max-width: var(--max); margin: 0 auto; }
  h1 {
    font-size: 40px;
    line-height: 1.15;
    margin: 0 0 16px;
    letter-spacing: -0.01em;
  }
  h2 {
    font-size: 22px;
    margin: 32px 0 12px;
  }
  p { margin: 0 0 14px; }
  .lede { font-size: 20px; color: var(--muted); margin: 0 0 32px; }
  code.token {
    display: block;
    background: var(--code-bg);
    padding: 14px 16px;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 14px;
    word-break: break-all;
    margin: 8px 0 12px;
  }
  pre.config {
    background: var(--code-bg);
    padding: 14px 16px;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    overflow-x: auto;
    margin: 8px 0 18px;
  }
  button.copy {
    padding: 10px 18px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    font-family: inherit;
    font-size: 15px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  button.copy:hover { opacity: 0.92; }
  button.copy:disabled { opacity: 0.6; cursor: default; }
  .cta {
    display: inline-block;
    margin: 12px 0 8px;
    padding: 12px 22px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    text-decoration: none;
    border-radius: 4px;
  }
  .cta:hover { opacity: 0.92; }
  .copied {
    margin-left: 12px;
    font-size: 14px;
    color: var(--muted);
    display: inline-block;
    vertical-align: middle;
  }
  footer {
    margin-top: 64px;
    padding-top: 24px;
    border-top: 1px solid var(--rule);
    color: var(--muted);
    font-size: 14px;
  }
  footer a { color: var(--muted); }
`;

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
 * config snippet. The "Copy token" button uses navigator.clipboard.
 */
export function renderMagicLinkSuccessPage(bearerToken: string): string {
  const safeToken = escapeHtml(bearerToken);
  const configJson = `{
  "mcpServers": {
    "veto": {
      "url": "https://getvetoed.com/mcp",
      "headers": {
        "Authorization": "Bearer ${bearerToken}"
      }
    }
  }
}`;
  const safeConfig = escapeHtml(configJson);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>You're in — Veto</title>
    <meta name="robots" content="noindex,nofollow">
    <style>${SHARED_STYLE}</style>
  </head>
  <body>
    <main>
      <h1>Veto</h1>
      <p class="lede">You're in. Welcome.</p>

      <h2>Your access token</h2>
      <code class="token" id="bearer-token">${safeToken}</code>
      <div>
        <button class="copy" id="copy-btn" type="button">Copy token</button>
        <span class="copied" id="copied-msg" aria-live="polite"></span>
      </div>

      <h2>Add this to your Claude Desktop config</h2>
      <p style="font-size: 15px; color: var(--muted);">
        macOS: <code>~/Library/Application Support/Claude/claude_desktop_config.json</code><br>
        Windows: <code>%APPDATA%\\Claude\\claude_desktop_config.json</code>
      </p>
      <pre class="config">${safeConfig}</pre>
      <p style="font-size: 15px; color: var(--muted);">
        Restart Claude Desktop, then run <code>validate_idea</code> against your next idea.
      </p>

      <footer>
        <p>
          <a href="https://getvetoed.com/">Back to getvetoed.com</a>
        </p>
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
            msg.textContent = 'Copied!';
            setTimeout(function () { msg.textContent = ''; }, 2200);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(token).then(done, function () {
              msg.textContent = "Copy failed — select and copy manually.";
            });
          } else {
            // Fallback for very old browsers.
            var range = document.createRange();
            range.selectNode(tokenEl);
            var sel = window.getSelection();
            if (sel) { sel.removeAllRanges(); sel.addRange(range); }
            try { document.execCommand('copy'); done(); }
            catch (e) { msg.textContent = "Copy failed — select and copy manually."; }
          }
        });
      })();
    </script>
  </body>
</html>`;
}

/**
 * Render the error page shown when the magic link is missing/expired/used/
 * not-found. Tells the user what went wrong and links back to the landing
 * page so they can request a new link.
 */
export function renderMagicLinkErrorPage(reason: MagicLinkErrorReason): string {
  const copy = ERROR_COPY[reason];
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(copy.title)}</title>
    <meta name="robots" content="noindex,nofollow">
    <style>${SHARED_STYLE}</style>
  </head>
  <body>
    <main>
      <h1>Veto</h1>
      <p class="lede">${escapeHtml(copy.headline)}</p>

      <p>${escapeHtml(copy.body)}</p>

      <p>
        <a class="cta" href="https://getvetoed.com/">Request a new sign-in link</a>
      </p>

      <footer>
        <p>
          <a href="https://getvetoed.com/">Back to getvetoed.com</a>
        </p>
      </footer>
    </main>
  </body>
</html>`;
}
