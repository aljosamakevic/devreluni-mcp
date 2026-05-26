# T00 — Express vs Hono spike for mounting `StreamableHTTPServerTransport`

> **Researcher:** GSD spike subagent, 2026-05-26
> **Time-boxed:** ~40 min (target 45)
> **SDK under test:** `@modelcontextprotocol/sdk@1.29.0` (already installed; on-disk inspection used as primary source)
> **CONTEXT.md basis:** decision 6 currently locks Express. This spike's job is to confirm or contest that.

---

## TL;DR

**Recommendation: Stay with Express. Confidence: HIGH.**

The MCP TypeScript SDK is a **first-class supporter of both** Express and Hono — it ships both as runtime dependencies and provides idiomatic, documented examples for each. There is no "MCP ecosystem is coalescing on X" signal that should override stack familiarity. Express wins on three concrete grounds for *this* phase:

1. The SDK ships a purpose-built `createMcpExpressApp()` helper (`@modelcontextprotocol/sdk/server/express.js`) — there is no equivalent `createMcpHonoApp()`. Built-in DNS-rebinding protection comes for free.
2. Phase 03 needs **5 distinct route groups with mixed middleware** (`/mcp` bearer-auth, `/admin/*` basic-auth, `/admin/api/*` basic-auth + JSON, `/` static, `/health` open). Express's middleware-ordering model maps to the existing PLAN.md task structure 1:1; switching mid-plan costs more than it saves.
3. The Node integration story for Hono is fine but the SDK's own Hono example uses the **WebStandard** transport (different class) and a **stateless, fresh-server-per-request** pattern — switching would force re-deciding session-mode and re-validating the auth flow.

**No 429 yet to flip Stream A. Tiebreaker isn't needed.** If the user *wanted* to switch on aesthetics, it'd be a Small re-flip (~2h for T01 + T07 + T13 + T26 wiring), but the spike found nothing that justifies it.

---

## 1. SDK integration shape

### 1a. Express — verified pattern (from SDK example `simpleStreamableHttp.js` + `jsonResponseStreamableHttp.js`)

```ts
// SDK verified: @modelcontextprotocol/sdk@1.29.0
// Entry points used:
//   '@modelcontextprotocol/sdk/server/streamableHttp.js'  -> StreamableHTTPServerTransport (Node)
//   '@modelcontextprotocol/sdk/server/express.js'         -> createMcpExpressApp helper
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';

const app = createMcpExpressApp({ host: '0.0.0.0' }); // app already has express.json + DNS-rebind guard
const transports: Record<string, StreamableHTTPServerTransport> = {};

app.post('/mcp', async (req, res) => {
  const sid = req.headers['mcp-session-id'] as string | undefined;
  let transport = sid ? transports[sid] : undefined;
  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: id => { transports[id] = transport!; },
    });
    await mcpServer.connect(transport);
  }
  await transport.handleRequest(req, res, req.body);  // pre-parsed body is fine
});

app.listen(3000);
```

**Rough edges:** none. The transport explicitly documents `parsedBody?: unknown` as a supported argument (`streamableHttp.d.ts:104-109`), so `express.json()` upstream is the recommended path. SDK example calls this pattern verbatim.

### 1b. Hono — verified pattern (from SDK example `honoWebStandardStreamableHttp.js`)

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport }
  from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

const app = new Hono();
app.use('*', cors({
  allowMethods: ['GET','POST','DELETE','OPTIONS'],
  allowHeaders: ['Content-Type','mcp-session-id','Last-Event-ID','mcp-protocol-version'],
  exposeHeaders: ['mcp-session-id','mcp-protocol-version'],
}));

app.all('/mcp', async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport();  // stateless: new per req
  const server = getMcpServer();
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);                          // raw Web Request
});

serve({ fetch: app.fetch, port: 3000 });
```

**Rough edges (material):**

- The SDK's Hono example uses a **different transport class** (`WebStandardStreamableHTTPServerTransport`, not `StreamableHTTPServerTransport`). You *can* use the Node transport with Hono via `c.env.incoming` / `c.env.outgoing`, but it's undocumented and defeats Hono's portability premise.
- The example is **stateless** (`new transport + new McpServer per request`). Phase 03 currently assumes a single shared `McpServer` instance — `index.ts` registers 13 tools once at boot. Switching to per-request server-construction means refactoring the tool-registration path or wrapping it in a factory; not hard, but it's extra work nothing in CONTEXT.md asks for.
- There is **no `createMcpHonoApp()` helper.** You wire CORS + headers manually (visible in the example — 6 lines that the Express helper hides).

### 1c. SDK fact that makes both viable

`StreamableHTTPServerTransport` (the Node variant) **internally uses `@hono/node-server`** to bridge Node ↔ Web Standard APIs — see `streamableHttp.d.ts:25-26`:

> *"This is a wrapper around `WebStandardStreamableHTTPServerTransport` that provides Node.js HTTP compatibility. It uses the `@hono/node-server` library to convert between Node.js HTTP and Web Standard APIs."*

So `@hono/node-server` is already a transitive runtime dep when you use the Express-mounted Node transport. Its production maturity isn't a question we need to answer — the SDK already trusts it.

---

## 2. Middleware ecosystem fit (Phase 03 specific)

| Need | Express score | Hono score | Notes |
|---|---|---|---|
| **Bearer-token auth** (custom; B/T07) | ⭐⭐⭐ | ⭐⭐⭐ | Both trivial. SDK *also* ships `requireBearerAuth` from `@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js` for Express, but it's OAuth-oriented (resource metadata, audience checks). Phase 03's Rung-1 static tokens are simpler than what that helper expects, so a custom 50-line middleware is right for both frameworks. |
| **Basic-auth for `/admin`** (F/T27) | ⭐⭐⭐ | ⭐⭐⭐ | `express-basic-auth@1.2.1` vs `hono/basic-auth` (built-in). Hono wins on "one less dep," Express wins on "more battle-tested." Functionally identical. |
| **Rate limiting** (C/T13) | ⭐⭐⭐ | ⭐⭐ | Express has `express-rate-limit` (the SDK depends on it!). For Hono you'd hand-roll (the PLAN already calls for a custom SQLite-backed limiter, so this advantage is partly moot for *this* phase, but it matters for any future "drop in a quick IP-bucket"). |
| **Static files** (F/T26: `public/` + `/admin/*` assets) | ⭐⭐⭐ | ⭐⭐ | Express: `express.static('public')` — one line. Hono on Node: `serveStatic` from `@hono/node-server/serve-static` — also one line but a separate import that's easy to miss in docs. |
| **pino logging integration** | ⭐⭐⭐ | ⭐⭐⭐ | `pino-http` for Express is canonical. Hono has `hono-pino` (less stars, less stable signature). Both work. |
| **JSON-RPC error handling** | ⭐⭐⭐ | ⭐⭐⭐ | Same wire-shape concerns; both frameworks let you write structured error responses. SDK's `handleRequest` owns the JSON-RPC envelope on the `/mcp` route, so this is mostly about the auth/admin error responses, which neither framework makes meaningfully easier. |

**Net:** Express ⭐⭐⭐ × 6 / Hono ⭐⭐⭐ × 4 + ⭐⭐ × 2. Margin is real but not large. The Express edge concentrates in `express-rate-limit` + `express.static`, both of which the PLAN already commits to.

---

## 3. DX / familiarity / ecosystem maturity

| Dimension | Express | Hono | Verdict |
|---|---|---|---|
| **Current MCP-specific examples** | `simpleStreamableHttp.js` (505+ lines, full OAuth flow), `jsonResponseStreamableHttp.js`, `sseAndStreamableHttpCompatibleServer.js`, `simpleStatelessStreamableHttp.js`, `standaloneSseWithGetStreamableHttp.js` — **5 Express-based examples** in `@modelcontextprotocol/sdk@1.29.0/dist/esm/examples/server/` | `honoWebStandardStreamableHttp.js` — **1 Hono-based example**, stateless only | Express |
| **StackOverflow / GH-issue coverage** | ~10 yrs, ~enormous corpus | Younger (~3 yrs); growing but you'll bottom out on edge-runtime questions when your problem is Node | Express (for 11pm debugging) |
| **TS 5.x strict-mode ergonomics** | Express 5 has proper types (the SDK pins `@types/express@^5.0.0`); declaration-merging `Request` is well-trodden | Hono is type-first by design — arguably nicer types if you adopt the framework end-to-end. Less of a win if you're just mounting a couple of routes. | Tie |
| **ESM-mode Node compatibility** | Verified real: SDK's own Express examples are `.js` files in `dist/esm/` and import as ESM. No CJS shim needed for Express 5 in ESM Node. | Verified real: Hono is ESM-native. | Tie |
| **Bundle size / startup time** | Larger (~600KB+ deps); irrelevant for a long-lived Fly app | Smaller; matters on edge, not on Fly | Trivial; ignore |
| **Long-term MCP trajectory** | SDK ships `createMcpExpressApp` helper as a public API. SDK depends on `express@^5.2.1` and `express-rate-limit` as runtime deps. | SDK ships Hono example only via `WebStandardTransport`; no Hono helper. SDK depends on `hono@^4.11.4` + `@hono/node-server@^1.19.9` as runtime deps. | The SDK is investing in BOTH but the Express path is more curated. |

**Verdict on DX:** Express has 5× more SDK-blessed examples, a dedicated helper, and 10× the Stack Overflow surface area. For a hosted production deployment where you'll debug at 11pm under stress (Phase 03's actual goal — let real users hit the endpoint), that asymmetry matters.

---

## 4. Migration cost from current Express decision

**If "switch to Hono" — actual blast radius:**

| Stream | Tasks needing rework | Effort |
|---|---|---|
| A (HTTP) | T01 rewritten (~70 lines); T03 health endpoint trivially ports; T04 smoke-test unaffected (it's a client) | ~2h |
| B (auth) | T07 middleware signature changes (Hono `Context` vs Express `req,res,next`); T10 supertest helpers replaced with Hono's `app.request()` testing helper | ~1.5h |
| C (rate limit) | T13 middleware signature changes (same as T07) | ~30min |
| D (deploy) | T16 Dockerfile unchanged; T17 fly.toml unchanged; T18 CI unchanged | 0 |
| E (obs) | T21 `pino-http` -> `hono-pino` (different API surface; less canonical) | ~1h |
| F (landing + admin) | T26 static serving: `express.static` -> `serveStatic`; T27 `express-basic-auth` -> `hono/basic-auth`; T28 admin API handlers rewritten | ~2h |
| G (calibration) | unaffected | 0 |

**Total flip estimate: ~7h = "M" (between Small and Large)** plus a refactor of `src/index.ts:T02` because the SDK's Hono example requires a per-request server factory pattern, whereas the current `index.ts` builds a single `McpServer` at boot. That factory refactor is also where the anti-bias non-regression risk (R4) lives — every tool/prompt/resource registration would now run per-request, which means the registration ordering invariants Phase 01 relied on get re-exercised on every call.

**Risk-weighted:** the switch is not "free middleware rework"; it touches the load-bearing `McpServer` lifecycle. R4 in PLAN.md already flags `index.ts` refactor as the highest-risk regression point.

---

## 5. Recommendation

**STAY WITH EXPRESS. Confidence: HIGH.**

Concrete reasons (ranked):

1. **SDK invests more in Express path.** 5 vs 1 example, dedicated `createMcpExpressApp()` helper with DNS-rebinding protection, `express-rate-limit` as SDK runtime dep. The SDK author treats Express-mounted as the "default for Node-hosted MCP servers" path. Hono path is positioned as "if you want portability to Workers/Deno/Bun" — which Fly.io explicitly doesn't need.
2. **No Hono advantage justifies the ~7h flip cost** at the v0.2 PLAN's current state. Bundle size and edge-runtime portability are non-goals for a Fly.io single-region SQLite-backed deployment.
3. **`McpServer` lifecycle disruption.** SDK's Hono example uses per-request `McpServer` construction; current `index.ts` uses single-instance. Migrating means re-validating that the anti-bias guarantees (which live in tool/prompt registrations) survive per-request reconstruction. That's a regression-surface expansion R4 warned about, with no compensating gain.
4. **Familiarity tiebreaker:** the user explicitly named ecosystem familiarity as their reason for picking Express in CONTEXT.md decision 6. The spike found no SDK-side evidence to override that.

**The one scenario that would flip me:** if Aljosa intends to deploy to Cloudflare Workers / Deno Deploy as a Phase 04+ goal, the Hono path becomes more attractive because the same code runs on edge runtimes. **CONTEXT.md scope explicitly defers multi-region to post-Phase-03 and doesn't mention edge runtimes at all**, so this isn't the case today.

---

## 6. Top 3 follow-up actions for the executor's T01

1. **SDK version pinned:** `@modelcontextprotocol/sdk@1.29.0` (already in `package.json` as `^1.29.0`; lock to exact via `npm install --save-exact @modelcontextprotocol/sdk@1.29.0` for production reproducibility — recommended for Phase 03 since the transport is a load-bearing dependency).
2. **Exact import paths to use:**
   - `import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';`
   - `import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';` *(use this instead of hand-rolling `express()` + `express.json()` + DNS-rebinding — saves ~15 lines and gets the DNS-rebind protection for free)*

3. **Non-obvious setup notes (cribbed from SDK examples):**
   - **DO** pre-parse the body with `express.json()` (or use `createMcpExpressApp` which does it). The transport accepts `parsedBody` as a third argument to `handleRequest(req, res, body)` — this is the documented and example-verified pattern. Do NOT remove `express.json()` and try to let the transport own the stream.
   - **Stateful vs stateless session mode:** for Phase 03, use **stateful** mode with `sessionIdGenerator: () => randomUUID()` + an in-memory `transports` map keyed by `mcp-session-id` header. This matches `simpleStreamableHttp.js` and `jsonResponseStreamableHttp.js` exactly. The `onsessioninitialized` callback is what writes into the map — do NOT write `transports[sid] = transport` inline before `onsessioninitialized` fires (race condition flagged in the SDK example comments at `jsonResponseStreamableHttp.js:84-89`).
   - **CORS headers** that MCP clients require (verified from `honoWebStandardStreamableHttp.js:36-41`, but the same list applies to Express via `cors` middleware):
     - allowHeaders: `Content-Type`, `mcp-session-id`, `Last-Event-ID`, `mcp-protocol-version`
     - exposeHeaders: `mcp-session-id`, `mcp-protocol-version`
     - allowMethods: `GET`, `POST`, `DELETE`, `OPTIONS`
   - **Bind host:** `createMcpExpressApp({ host: '0.0.0.0' })` for Fly.io (containers can't bind 127.0.0.1 and serve external traffic). Default `127.0.0.1` is wrong for production; spike-confirmed via `express.d.ts:37` example.
   - **Mind `app.post('/mcp')` AND `app.get('/mcp')`:** the spec uses GET for the standalone SSE stream. If Phase 03 doesn't need server-initiated push, return `405 Method Not Allowed` with `Allow: POST` (matches `jsonResponseStreamableHttp.js:127-131`).

---

## Sources

**Primary (HIGH confidence — on-disk inspection of installed SDK):**
- `/Users/aljosamakevic/Documents/Buildground/Sandbox/03-devreluni-mcp/devreluni-mcp/node_modules/@modelcontextprotocol/sdk/package.json` — version 1.29.0; deps include `express@^5.2.1`, `hono@^4.11.4`, `@hono/node-server@^1.19.9`, `express-rate-limit@^8.2.1`
- `/Users/aljosamakevic/Documents/Buildground/Sandbox/03-devreluni-mcp/devreluni-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.d.ts` — Node transport API
- `/Users/aljosamakevic/Documents/Buildground/Sandbox/03-devreluni-mcp/devreluni-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/server/express.d.ts` — `createMcpExpressApp` helper
- `/Users/aljosamakevic/Documents/Buildground/Sandbox/03-devreluni-mcp/devreluni-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/examples/server/simpleStreamableHttp.js` — Express + OAuth full example
- `/Users/aljosamakevic/Documents/Buildground/Sandbox/03-devreluni-mcp/devreluni-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/examples/server/jsonResponseStreamableHttp.js` — Express + JSON-response stateful mode (closest to Phase 03's needs)
- `/Users/aljosamakevic/Documents/Buildground/Sandbox/03-devreluni-mcp/devreluni-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/examples/server/honoWebStandardStreamableHttp.js` — only Hono example; stateless

**Secondary (MEDIUM confidence — npm registry):**
- `npm view @hono/node-server` → v2.0.4, published 2026-05-24, zero deps, actively maintained
- `npm view hono` → v4.12.23
- `npm view express` → v5.2.1
- `npm view express-basic-auth` → v1.2.1

**Did not need to query** (cited from authoritative on-disk source instead):
- Context7 / MCP SDK docs site — the installed SDK examples are the canonical source of truth and they live on disk.

---

## Spike metadata

- **Time spent:** ~40 min (8 min reading CONTEXT/PLAN/package, 18 min reading SDK on disk, 6 min npm registry checks, 8 min writing)
- **Confidence breakdown:**
  - SDK integration pattern (both frameworks): HIGH — read the actual examples
  - Middleware fit scoring: HIGH for Express (well-known), MEDIUM for Hono (some scoring is "I read the docs but didn't build it")
  - Recommendation: HIGH
  - Migration cost estimate: MEDIUM — based on PLAN.md line counts, not a real port
- **What I did NOT verify:** whether `pino-http` and the SDK's `express@5.2.1` have a clean ESM-mode interop story (Express 5 is GA on npm but there's a small history of `pino-http` middleware-order quirks). Recommend the executor sanity-check in T21.
- **Open questions left for executor:**
  - Should T01 lock to `@modelcontextprotocol/sdk@1.29.0` exact, or accept `^1.29.0`? (Recommend exact for Phase 03's first deploy; relax later.)
  - The 5 Express examples include OAuth flows that Phase 03 doesn't need. Verify the executor cribs from `jsonResponseStreamableHttp.js` (stateful, simple) not `simpleStreamableHttp.js` (OAuth, complex).
