# Operations runbook

Operator-facing doc for running the Vetoed MCP server on Fly.io.
Pairs with [`DNS_SETUP.md`](./DNS_SETUP.md) (DNS + TLS cert) and
[`HOSTED_SETUP.md`](./HOSTED_SETUP.md) (user onboarding).

---

## 1. First-time deploy prereqs

Do these IN ORDER before the first `flyctl deploy` (or before the
first push to `main` triggers the CI deploy workflow in
`.github/workflows/deploy.yml`).

### 1.1 Create the persistent volume

```
flyctl volumes create vetoed_data --size 1 --region iad
```

This MUST happen before the first deploy. `fly.toml` references the
`vetoed_data` volume by name in the `[mounts]` block (destination
`/data`). If the volume doesn't exist when Fly tries to mount it,
the deploy fails — or worse, the app starts with `/data` backed by
ephemeral storage and tokens / usage logs vanish on every restart.

Confirm the volume is healthy:

```
flyctl volumes list -a vetoed-mcp
```

Expect a single row named `vetoed_data` in region `iad`, size `1` GB.

### 1.2 Set the application secrets

```
flyctl secrets set SERPER_API_KEY=<value>
flyctl secrets set PRODUCTHUNT_API_KEY=<value>
flyctl secrets set GITHUB_TOKEN=<value>
flyctl secrets set ADMIN_PASSWORD=<value-12+chars>
```

Each `flyctl secrets set` triggers a rolling restart. Run them all
before the first deploy so the first machine boot has every secret
present.

`ADMIN_PASSWORD` MUST be at least 12 chars. The admin middleware
fails-closed (HTTP 500) on shorter values — by design (see T27 / R6).

### 1.3 Add the GitHub Actions secret

Repository -> Settings -> Secrets and variables -> Actions ->
New repository secret:

| Name             | Value                                    |
|------------------|------------------------------------------|
| `FLY_API_TOKEN`  | output of `flyctl auth token` (or a deploy token from the Fly dashboard) |

Without `FLY_API_TOKEN`, the CI workflow's deploy step fails with a
permission error.

### 1.4 Provision the TLS cert

After DNS resolves (see `DNS_SETUP.md`):

```
flyctl certs add getvetoed.com
```

Verify with `flyctl certs show getvetoed.com` — wait for
`Status: Ready` before pointing users at `https://getvetoed.com/mcp`.

---

## 2. Fly metrics dashboard

Production metrics live at:

```
https://fly.io/apps/vetoed-mcp/metrics
```

Built-in graphs (no extra instrumentation required):

| Graph              | What to watch for                                |
|--------------------|--------------------------------------------------|
| CPU usage          | Sustained > 80% means a single machine is hot — scale up via `flyctl scale count 2`. |
| Memory usage       | Sustained > 80% means SQLite WAL is growing or pino buffers are backing up — check `flyctl logs` for `serper_global_cap` spikes. |
| Requests per sec   | Trend; an unexpected ramp can correlate with a leaked bearer token (cross-check `flyctl logs` for the same token id firing many tool calls). |
| Response time p95  | > 5s means upstream Serper / ProductHunt / GitHub APIs are slow; surface as `confidence_note` in tool envelopes is honest-graceful per spec §7. |

For deeper insight, the Fly dashboard also exposes machine-level
CPU + I/O graphs under `/machines`.

---

## 3. Custom metrics — deferred (D-03-1)

Cache hit-rate, tool-level success rates, and Serper-budget burndown
are not surfaced as custom metrics in v1. The `/health` endpoint
returns `cache_hit_rate: null` and the dashboard renders only the
built-in graphs above.

Phase 04 candidate: instrument `src/lib/cache.ts` with hit/miss
counters and expose them via either `/metrics` (Prometheus
text-format) or a custom Fly chart.

---

## 4. Log inspection

```
flyctl logs -a vetoed-mcp
```

Pino emits structured JSON to stdout; Fly captures it into the log
stream. Useful grep patterns:

| Pattern                              | What it surfaces                                       |
|--------------------------------------|--------------------------------------------------------|
| `pv_`                                | Bearer-token prefixes; a leaked token shows up as the same prefix firing many calls from many IPs. |
| `rate_limit_per_token_exceeded`      | Per-token 400-calls/day cap hits — capacity signal; if frequent, raise the threshold or onboard the user to a higher tier (post-MVP). |
| `serper_global_cap`                  | The 1,500 Serper calls/UTC-day global cap fired — downstream tools degraded gracefully (NO 429, per spec §7 + C7). Watch for sustained hits across multiple UTC days; that's the signal to upgrade the Serper plan or shard the cap. |
| `admin_password_misconfigured`       | `ADMIN_PASSWORD` is unset / empty / < 12 chars. Admin endpoints are returning 500 (fail-closed). Fix with `flyctl secrets set ADMIN_PASSWORD=<12+ chars>`. |
| `level":50`                          | pino `error`-level log entries; correlate timestamp with the `last_error_at` field from `/health`. |

To stream live and filter at the same time:

```
flyctl logs -a vetoed-mcp | grep -F 'serper_global_cap'
```

---

## 5. Secrets rotation

Rotate any one of the four application secrets — `SERPER_API_KEY`,
`PRODUCTHUNT_API_KEY`, `GITHUB_TOKEN`, `ADMIN_PASSWORD` — by re-running
the corresponding command from section 1.2 with the new value. Use
the same syntax shown there (`flyctl secrets set <KEY>=<NEW_VALUE>`,
one secret per invocation). `ADMIN_PASSWORD` must remain at least 12
chars or the admin middleware fails-closed.

Each invocation of that command:

- Encrypts the value in Fly's secret store.
- Triggers a rolling restart of all machines (one at a time so the
  service stays up). The next process boot reads the new value via
  `process.env`.
- Brief 5–15s window of partial-cluster restart; the
  `/health` endpoint stays 200 throughout because at least one
  machine is always live.

Rotation cadence: opportunistic (after a suspected leak) or
quarterly. `ADMIN_PASSWORD` rotates whenever an operator who knows
it leaves the project.

---

## 6. Admin CLI runbook (canonical — in-container path)

The admin CLI ships inside the runtime image (per T16 / C3). The
canonical operator path is `flyctl ssh console` into a live machine
and run `npm run admin` against the production DB on the mounted
`/data` volume:

```
flyctl ssh console -a vetoed-mcp
# inside the container:
cd /app && npm run admin -- list-tokens
```

Available subcommands (see `scripts/admin.ts` for full flags):

```
cd /app && npm run admin -- issue-token --email=alice@example.com
cd /app && npm run admin -- list-tokens
cd /app && npm run admin -- revoke-token pv_a1b2c
cd /app && npm run admin -- revoke-token 42         # numeric id
```

`issue-token` prints the plaintext `pv_<…>` token EXACTLY ONCE. Copy
it to the requesting user immediately; after that only the 7-char
prefix `pv_xxxxx` is ever visible in `list-tokens`.

---

## 7. Alternative admin path (advanced — `flyctl proxy`)

Only use this fallback if `flyctl ssh console` is unavailable
(e.g., the machine is wedged on a network issue but the volume
is still mountable elsewhere). Proxy the production DB to localhost
and run the admin CLI against the proxied SQLite file via a
file copy:

```
# Copy the live DB locally via SFTP over flyctl ssh
flyctl ssh sftp shell -a vetoed-mcp
get /data/vetoed.db ./vetoed.db
exit

# Run admin CLI against the local copy (READ-ONLY equivalents only —
# writes do not flow back without an explicit `put`):
VETOED_DB_PATH=./vetoed.db npm run admin -- list-tokens
```

This path is read-only-safe; do NOT `issue-token` or `revoke-token`
against the local copy unless you immediately upload the mutated
DB back to `/data/vetoed.db` and restart the app. The canonical
SSH-console path (section 6) avoids the upload step entirely.

---

## 8. Token revocation

Revocation uses the admin CLI from section 6; no secret rotation
needed:

```
flyctl ssh console -a vetoed-mcp
cd /app && npm run admin -- revoke-token pv_a1b2c   # by prefix
# OR
cd /app && npm run admin -- revoke-token 42         # by numeric id
```

A revoked token's next call against `POST /mcp` returns
`401 unauthorized` with body
`{ error: 'unauthorized', reason: 'invalid_or_revoked_token' }`.
No restart required — the change takes effect on the next request
because token validation reads `status='active'` on every call.

---

## 9. Verify rotation

After any of the above (secrets rotation, admin CLI mutation,
revocation), confirm the service is healthy:

```
curl https://getvetoed.com/health
# expected: HTTP/2 200 with body
# {"status":"ok","version":"...","db_ok":true,...}
```

If `db_ok` is `false`, the volume mount likely failed or the DB
file is locked — inspect with `flyctl logs -a vetoed-mcp` and
`flyctl volumes list -a vetoed-mcp`.
