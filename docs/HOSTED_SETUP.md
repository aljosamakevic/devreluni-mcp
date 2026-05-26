# Vetoed hosted MCP — Claude Desktop setup

How to point Claude Desktop at the hosted Vetoed MCP server and start
killing bad product ideas before you build them.

Time required: ~3 minutes once you have a token.

---

## 1. Get a token

The hosted endpoint is invite-only during private beta. Email
**aljosa@getvetoed.com** with the subject line "Vetoed access
request" and a one-line note about what you're building. You'll
receive a token that looks like `pv_<32 chars>` (40 chars total,
prefixed `pv_`).

Keep the token somewhere safe — it's shown exactly once when issued
and we can't retrieve the plaintext later. If you lose it, email
back and we'll revoke + reissue.

---

## 2. Add to Claude Desktop config

Open (or create) the Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Claude Desktop ships native stdio MCP support; it does NOT yet ship a
native HTTPS/streamable-HTTP client. The community-standard bridge is
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) — a tiny
stdio→streamable-HTTP shim run via `npx`. Add a `vetoed` entry to
the `mcpServers` block:

```json
{
  "mcpServers": {
    "vetoed": {
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

Replace `pv_REPLACE_WITH_YOUR_TOKEN` with the token from step 1.
`mcp-remote` forwards every JSON-RPC frame to
`https://getvetoed.com/mcp` with the `Authorization` header attached;
no token is stored on Anthropic infrastructure.

**Note on direct streamable-HTTP support.** The official MCP
registry schema documents `type: "streamable-http"` + `url` +
`headers` directly, but Claude Desktop (as of this writing) still
ingests servers via the legacy `command`/`args` stdio shape. When
Claude Desktop adds native streamable-HTTP support, the equivalent
config will look like:

```json
{
  "mcpServers": {
    "vetoed": {
      "type": "streamable-http",
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

## 3. Verify it works

In a new Claude Desktop conversation, ask:

> Run validate_idea on this idea: "AI-native focus app for iPhone
> that uses on-device ML to reduce screen time."

You should see Claude orchestrate a sequence of tool calls
(`find_closest_competitor`, `check_big_tech_encroachment`,
`scan_producthunt_launches`, etc.) and finish with a structured
`finalize_validation_report` markdown verdict.

### Troubleshooting

| Symptom                                              | Likely cause                                                        | Fix                                                                          |
|------------------------------------------------------|---------------------------------------------------------------------|------------------------------------------------------------------------------|
| `401 unauthorized` in Claude's MCP error panel       | Token typo or missing `Bearer ` prefix in the header arg.           | Re-check the `Authorization:Bearer pv_…` string — exactly one space-free `:`. |
| `429 rate_limited`, `Retry-After: N` shown           | You hit the per-token daily cap (see section 4).                    | Wait `N` seconds (Claude shows the value) or email for a higher limit.       |
| `500 internal_server_error`                          | Upstream API outage or a fresh deploy regression.                   | Email aljosa@getvetoed.com with the timestamp; we keep `flyctl logs`.        |
| Tools work but a verdict mentions `serper_global_cap`| The global 1,500 Serper-calls/day cap fired across all users.       | Honest-gap behavior, not a bug — see section 4.                              |
| `mcp-remote: command not found` in Claude logs       | npx couldn't fetch the package (offline / proxy).                   | Run `npx -y mcp-remote@latest --help` in a terminal once to prime the cache. |

---

## 4. Rate limits

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

## 5. Stdio fallback (power users / local dev)

If you'd rather run the server locally (no network, no rate cap, no
hosted-service dependency), the original stdio transport is
unchanged. Clone the repo, run `npm install && npm run build`, then
point Claude Desktop at the build:

```json
{
  "mcpServers": {
    "vetoed-local": {
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
+ bearer token in section 2.

You can keep both `vetoed` (hosted) and `vetoed-local` (stdio)
configured side-by-side and Claude Desktop will surface both as
distinct MCP server entries.
