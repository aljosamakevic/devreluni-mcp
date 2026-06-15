# Veto hosted MCP — client setup

How to point your MCP client at the hosted Veto server and start
killing bad product ideas before you build them.

Time required: ~2 minutes once you have a token.

---

## 1. Get a token

Most users get a token via the self-serve magic-link flow at
**<https://getvetoed.com/>**:

1. Enter your email under "Get your token".
2. Click the sign-in link in the email (15-minute expiry, single use).
3. The verify page shows your bearer token + a copy-paste config block
   pre-filled with the token.

Tokens look like `pv_<32 chars>` (40 chars total, prefixed `pv_`). They
are shown exactly once at issue time — copy them somewhere safe. If
you lose one, request a new sign-in link and a fresh token is minted.

This document is for the direct CLI-config path — useful when you'd
rather paste the token into a config file yourself than go through the
self-serve UI.

---

## 2. Claude Desktop

Open (or create) the Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Claude Desktop ships native stdio MCP support; it does NOT yet ship a
native HTTPS/streamable-HTTP client. The community-standard bridge is
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) — a tiny
stdio→streamable-HTTP shim run via `npx`. Add a `veto` entry to the
`mcpServers` block:

```json
{
  "mcpServers": {
    "veto": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://getvetoed.com/mcp",
        "--header",
        "Authorization:Bearer pv_REPLACE_WITH_YOUR_TOKEN"
      ]
    }
  }
}
```

Replace `pv_REPLACE_WITH_YOUR_TOKEN` with your token from step 1.
`mcp-remote` forwards every JSON-RPC frame to
`https://getvetoed.com/mcp` with the `Authorization` header attached;
no token is stored on Anthropic infrastructure.

**Note on direct streamable-HTTP support.** The official MCP registry
schema documents `type: "streamable-http"` + `url` + `headers`
directly, but Claude Desktop (as of this writing) still ingests
servers via the legacy `command`/`args` stdio shape. When Claude
Desktop adds native streamable-HTTP support, the equivalent config
will look like:

```json
{
  "mcpServers": {
    "veto": {
      "url": "https://getvetoed.com/mcp",
      "headers": { "Authorization": "Bearer pv_REPLACE_WITH_YOUR_TOKEN" }
    }
  }
}
```

Both forms are supported by the server — the difference is purely
client-side. Citation: MCP Registry remote-server schema docs at
`https://modelcontextprotocol.io/registry/remote-servers` (verified
2026-05-26 via Context7).

Save the file and restart Claude Desktop (full quit + relaunch — not
just close the window).

---

## 3. Cursor

Cursor (a VS Code fork) ships native MCP support with the same
`mcpServers` shape as Claude Desktop, in its own config file:

- **All platforms:** `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "veto": {
      "url": "https://getvetoed.com/mcp",
      "headers": { "Authorization": "Bearer pv_REPLACE_WITH_YOUR_TOKEN" }
    }
  }
}
```

Restart Cursor after editing. The Veto tools appear in any chat panel
when `@veto` is invoked or when an agent task is in a workspace where
the MCP server is enabled.

---

## 4. Codex CLI

OpenAI's terminal coding agent reads MCP server entries from a TOML
config:

- **Path:** `~/.codex/config.toml`

```toml
[mcp_servers.veto]
url = "https://getvetoed.com/mcp"
headers = { Authorization = "Bearer pv_REPLACE_WITH_YOUR_TOKEN" }
```

Codex CLI does not require a restart — it re-reads the config at the
start of each session.

---

## 5. Generic Streamable HTTP MCP (Cline, Goose, Aider, …)

Any MCP-compliant client that supports the Streamable HTTP transport
can use Veto directly:

- **URL:** `https://getvetoed.com/mcp`
- **Header:** `Authorization: Bearer pv_REPLACE_WITH_YOUR_TOKEN`

Consult your client's MCP docs for where to paste these. The Veto
server speaks the spec-compliant Streamable HTTP shape — no
client-specific quirks.

---

## 6. Verify it works

In a new conversation, ask:

> Run validate_idea on this idea: "AI-native focus app for iPhone
> that uses on-device ML to reduce screen time."

You should see your client orchestrate a sequence of tool calls
(`find_closest_competitor`, `check_big_tech_encroachment`,
`scan_producthunt_launches`, etc.) and finish with a structured
`finalize_validation_report` markdown verdict.

### Troubleshooting

| Symptom                                              | Likely cause                                                        | Fix                                                                          |
|------------------------------------------------------|---------------------------------------------------------------------|------------------------------------------------------------------------------|
| `401 unauthorized` in your client's error panel      | Token typo or missing `Bearer ` prefix in the header.               | Re-check the `Authorization: Bearer pv_…` string — exactly one space-free `:`. |
| `429 rate_limited`, `Retry-After: N` shown           | You hit the per-token daily cap (see section 7).                    | Wait `N` seconds (your client shows the value) or request a higher limit.    |
| `500 internal_server_error`                          | Upstream API outage or a fresh deploy regression.                   | Email aljosa.sandbox@gmail.com with the timestamp; we keep `flyctl logs`.    |
| Tools work but a verdict mentions `serper_global_cap`| The global 1,500 Serper-calls/day cap fired across all users.       | Honest-gap behavior, not a bug — see section 7.                              |
| `mcp-remote: command not found` in Claude Desktop logs | npx couldn't fetch the package (offline / proxy).                  | Run `npx -y mcp-remote@latest --help` in a terminal once to prime the cache. |

---

## 7. Rate limits

400 tool calls / day / token. A typical `validate_idea` run fires
~13 tool calls, so you get ~30 typical runs / day. A run hitting
the spec UPPER bound of 20 tool calls gets you exactly 20 runs /
day guaranteed. Global cap: 1,500 Serper calls / day across all
users — if hit, some tool responses gracefully degrade to stub data
(you'll see `fallbacks_used: ['serper_global_cap']` in the response
envelope).

When the per-token cap fires, the server returns HTTP 429 with a
`Retry-After` header (seconds until the oldest call in your 24h
window falls out). When the global Serper cap fires, the affected
tools degrade gracefully — they return a normal HTTP 200 with stub
data plus `fallbacks_used: ['serper_global_cap']` in the envelope,
and the surrounding `confidence_note` flags the missing live signal
honestly. There is NO 429 for the global cap; honest gap-surfacing
beats silently-elevated confidence.

---

## 8. Stdio fallback (power users / local dev)

If you'd rather run the server locally (no network, no rate cap, no
hosted-service dependency), the original stdio transport is
unchanged. Clone the repo, run `npm install && npm run build`, then
point Claude Desktop at the build:

```json
{
  "mcpServers": {
    "veto-local": {
      "command": "node",
      "args": ["/absolute/path/to/devreluni-mcp/build/index.js"],
      "env": {
        "SERPER_API_KEY": "<your-key>",
        "PRODUCTHUNT_API_KEY": "<your-key>",
        "GITHUB_TOKEN": "<your-key>"
      }
    }
  }
}
```

The same 13 tools + 5 prompts are registered against the same
`McpServer` instance in both modes. The only difference is the
transport: stdio + local env vars in this section, streamable HTTP
+ bearer token in sections 2–5.

You can keep both `veto` (hosted) and `veto-local` (stdio) configured
side-by-side; your client surfaces both as distinct MCP server
entries.
