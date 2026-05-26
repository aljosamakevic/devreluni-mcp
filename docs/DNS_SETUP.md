# DNS setup for `getvetoed.com`

Operator-facing doc. End-users do NOT need this — see
[`HOSTED_SETUP.md`](./HOSTED_SETUP.md) for the user-onboarding path.

Goal: make `https://getvetoed.com/mcp` resolve to the Fly.io app
`vetoed-mcp.fly.dev` with a valid Let's Encrypt TLS cert.

---

## 1. One-time DNS record

At the registrar where `getvetoed.com` is managed, add a CNAME
record:

```
getvetoed.com   CNAME   vetoed-mcp.fly.dev
```

(`vetoed-mcp.fly.dev` is the default `<app>.fly.dev` hostname Fly
issues — if `fly.toml`'s `app = "vetoed-mcp"` changes, update both
this record and the CNAME target in the same change.)

### Apex-domain note

Some registrars don't permit a literal `CNAME` on the apex (root)
domain. If `getvetoed.com` is the apex you're publishing on, use
the registrar's CNAME-flattening equivalent:

| Registrar  | Apex-CNAME mechanism            |
|------------|---------------------------------|
| Cloudflare | "CNAME flattening" (automatic)  |
| Route 53   | `ALIAS` record                  |
| Netlify    | `ALIAS` record                  |
| DNSimple   | `ALIAS` record                  |
| Generic    | `ANAME` record (if supported)   |

If the registrar supports none of the above, use Fly's IPv4 A
record + IPv6 AAAA record instead. Run `flyctl ips list -a vetoed-mcp`
to get the addresses; configure `getvetoed.com` -> `A` + `AAAA`.

---

## 2. Provision the TLS cert on Fly

After the DNS record is in place (don't wait for full propagation —
Fly's challenge runs against the live DNS as soon as it can):

```
flyctl certs add getvetoed.com
```

Fly issues a Let's Encrypt cert via HTTP-01 / DNS-01 challenge.
Check status:

```
flyctl certs show getvetoed.com
```

Expect: `Status: Ready` once the cert is live (usually <2 minutes
after DNS resolves).

---

## 3. Verify

```
dig getvetoed.com CNAME +short
# expected: vetoed-mcp.fly.dev.   (or the A/AAAA pair if apex-A path used)

curl -v https://getvetoed.com/health
# expected: HTTP/2 200, valid Let's Encrypt cert, JSON body with
#           status: "ok"
```

If `curl -v` shows a cert error, run
`flyctl certs check getvetoed.com` to debug.

---

## 4. Propagation timing (R3)

DNS propagation varies by registrar + TTL. Typical range: 15 minutes
to 24 hours. Cloudflare-fronted domains usually propagate in
under 5 minutes; pure-registrar DNS can take longer.

While waiting, the deploy can still be exercised against
`https://vetoed-mcp.fly.dev/mcp` directly — both endpoints terminate
the same Fly app and the same TLS certificate path. The downstream
phase regression script (`scripts/run-fomi-via-https.ts`,
T-final-3a/3b) accepts the Fly fallback URL via the `--endpoint`
flag; the artifact frontmatter records which endpoint was used so a
follow-up can re-verify once DNS lands (OQ2 fallback path).

---

## 5. Renewal

Let's Encrypt certs auto-renew via Fly. No operator action required
unless `flyctl certs show getvetoed.com` reports `Status:
Awaiting configuration` or similar — in that case the DNS record
likely drifted; verify with `dig` and re-add via `flyctl certs add
getvetoed.com`.
