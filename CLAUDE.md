# CLAUDE.md

Guidance for any Claude Code session (local, cloud, or mobile) working in this repo. If the codebase contradicts this file, trust the codebase. For deeper session-to-session context, read `HANDOFF.md`; for visual + voice rules, read `BRAND.md`.

## What this is

**Veto** (`getvetoed.com`) is an MCP server for structured product-idea validation. It exposes 13 tools, 5 prompts, and 4 resources over Streamable HTTP, and is its own OAuth 2.1 Authorization Server + Resource Server so it can be added as a custom connector in Claude and ChatGPT. Node 22 + TypeScript, SQLite (`better-sqlite3`), deployed to Fly.io (`vetoed-mcp`) via GitHub Actions on push to `main`.

## Required checks (must pass after every change)

```bash
npm run build        # tsc + copy schema + regenerate landing tools section
npm test             # vitest run (full suite)
npx tsx scripts/assert-fomi-run.ts   # anti-bias regression gate — MUST exit 0 (6/6 PASS)
npm run smoke:http   # end-to-end Streamable HTTP smoke (when touching the transport/tools)
npx --yes html-validate@9 public/index.html   # when editing the landing page
```

`assert-fomi-run.ts` reads a static artifact, so validator code changes won't move it on their own — re-run it, don't assume.

## INVIOLATE — do not modify without fresh, explicit human authorization

These files encode the anti-bias property that is the entire point of the product:

- `src/validation/` (the whole directory)
- `src/lib/bias.ts`
- `src/prompts/validate-idea.ts`
- `src/tools/finalize-validation-report.ts`

Do not change verdict math, bias/tier logic, the renderer, the schema, or the validation prompt without the human explicitly approving the specific change first (ask via a direct question). String-only changes to descriptions/notes still require sign-off. After any approved change here, re-run `assert-fomi-run.ts` and confirm 6/6.

## Conventions

- **Atomic commits.** Build + test + `assert-fomi-run` green before each commit. Commit body explains WHY. Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Branch-first for auth / production changes.** Build on a feature branch, verify end-to-end (unit + live HTTP), merge `--no-ff`, deploy as one unit. Never half-ship an auth flow to `main`.
- **Push/deploy only when the human asks.** Pushing to `main` triggers a prod deploy via CI.
- **No em dashes in user-facing copy** (see `BRAND.md`). Verdicts are all-caps (GO / NO-GO / CONDITIONAL GO / PASS / FAIL / INCONCLUSIVE). Forbidden words: powerful, insights, AI-powered, discover, unlock, supercharge, game-changer.
- **`BRAND.md` is the source of truth** for visual design and voice.
- **Do not `git add -A`.** It stages embedded git repos under `.claude/` / `.worktrees/`. Stage specific files. (`.claude/`, `.worktrees/`, `coverage/` are untracked and expected.)
- **stdio stdout is the JSON-RPC channel.** Anything written to it (a stray log line, an oversized payload) corrupts the client. The logger writes to stderr — keep it that way.

## Onboarding model (user-facing)

Connector-only: users add Veto as a custom connector in Claude (Settings → Connectors → Add custom connector) or ChatGPT (Settings → Connectors → Advanced settings → enable Developer mode → Create) using the URL `https://getvetoed.com/mcp` + OAuth email sign-in. There is no token-paste / config-file path on the landing page; the magic-link backend endpoint still exists for manual/CLI token issuance.

## Verify behavioral lesson

Do not trust a model's (or a doc's) narration of a bug's root cause. Reproduce against `flyctl logs -a vetoed-mcp` or the code before believing an infrastructure explanation. `honest_gap` tool status means "ran fine, found nothing" — it is a finding, not a failure.
