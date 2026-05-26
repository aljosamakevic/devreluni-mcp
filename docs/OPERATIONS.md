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
