# Phase 06 — Brand landing rebuild

## Phase goal

Apply the locked v1 brand (`BRAND.md` at repo root) to every user-facing surface that touches a new visitor or new user: the landing page, the magic-link verification page, and the two outbound email templates. Add user-installable docs (Claude Desktop + Cursor + OpenAI Responses API) with copy-paste config snippets. Add an inline tools section auto-extracted from code. Add a hero animation that proves the framework works through motion. Show a real captured Fomi NO-GO excerpt as evidence.

The phase deliverable is a single coherent first impression of Veto — visually, verbally, and structurally consistent with `BRAND.md`.

## Why this matters

Phase 05a removed the admin-approval bottleneck (signup is now magic-link self-serve). Phase 06 removes the second bottleneck: visitors arriving at https://getvetoed.com don't understand what Veto is, can't see it working, and have no clear install path. The landing page is currently a placeholder from Phase 03 — minimum-viable static HTML that predates the brand work.

A polished landing that loads the BRAND.md identity end-to-end is the conversion layer between "someone clicked a link" and "someone installed an MCP token." Without it, magic-link self-serve doesn't matter — there's no one to convert.

## Locked design decisions (Aljosa, 2026-06-15)

### Scope

1. **In scope:** Landing page rebuild, magic-link verification page restyle, BOTH email templates restyled (approval + magic-link).
2. **Out of scope:** Admin dashboard restyle (internal, Aljosa-only — deferred to a later phase).
3. **Tools docs:** inline section on landing page, NOT a separate `/docs` page. Auto-extracted from the code's registration `description` fields (zero drift between code and docs).
4. **Install instructions:** three-tier section structure (see decision 11 below) covering Claude Desktop, Cursor, OpenAI Responses API, with a generic Streamable HTTP fallback.
5. **Hero animation:** in scope, medium fidelity — CSS-driven gate sequence + verdict drop, plays on scroll-into-view, respects `prefers-reduced-motion`. NOT a Linear-style WebGL build.
6. **Evidence sample:** real captured Fomi NO-GO excerpt from `.planning/validation-runs/03-fomi-via-https.md`. 1-2 gates visible with DOK 1 evidence + tier badges. "Don't tell, show."
7. **Copy buttons:** copy button on the MCP URL line AND on the full JSON config block for each client. Vanilla JS `navigator.clipboard` with `document.execCommand` fallback (same pattern as Phase 05a's verification page).

### Brand application defaults (Claude's calls, easy to override)

8. **Light mode:** skipped entirely. BRAND.md states dark is primary; no toggle in v1.
9. **Fonts:** Google Fonts CDN — `DM Mono` (400, 500) + `Inter` (400, 500). Two font-family declarations only. No font fallback chain beyond system defaults.
10. **CSS approach:** vanilla CSS, no framework. BRAND.md's design tokens map cleanly to CSS custom properties.
11. **Verdict stamp motif:** used as a 15% opacity hero watermark + inline (full opacity, small) in the evidence sample only. NOT decorative anywhere else per BRAND.md "No decorative elements" rule.
12. **Breakpoints:** mobile-first. `<768px` mobile layout, `>=768px` desktop. Grid max-width 1200px with 32px gutters desktop, 16px gutters mobile (per BRAND.md).
13. **Accessibility:** WCAG AA contrast. BRAND.md palette already passes (text `#F5F4F0` on bg `#111210` = 16.4:1). Tab focus visible. ARIA labels on copy buttons. `prefers-reduced-motion` respected for hero animation.
14. **Analytics:** none in this phase. Plausible / Umami integration is a separate phase concern.
15. **SEO:** basic meta tags (title, description, OG image, Twitter card), structured data (`Application` schema with `applicationCategory: BusinessApplication`). No sitemap for a single-page site.

### Hero animation (decision 5 — fidelity locked)

The hero right panel from BRAND.md describes a live validation run. v1 fidelity:

- CSS keyframe sequence, no JS animation library.
- Intersection Observer triggers play when hero scrolls into view.
- Sequence (~6 seconds total, single-shot, no loop):
  1. **0.0-1.0s:** Gate ID labels appear one by one (G1, G2, G3, G4, G5) in DM Mono mono uppercase, BRAND.md tertiary color.
  2. **1.0-2.5s:** Source rows appear under each gate. 2-3 rows per gate. Each row: tier badge (DM Mono 10px, tier color background) + truncated URL (DM Mono 12px, secondary text).
  3. **2.5-3.5s:** Status badges per gate slot in (PASS / FAIL / INCONCLUSIVE). 4 gates fail / 1 inconclusive (mirrors the actual Fomi NO-GO verdict shape).
  4. **3.5-4.5s:** Contradicting evidence section fades in below.
  5. **4.5-6.0s:** Verdict stamp drops in from above with a settle motion (rotate -8deg, scale 0.95 → 1.0, slight overshoot). The verdict reads `NO-GO`.
- `prefers-reduced-motion: reduce` → instantly renders the end state, no transitions.
- Animation does NOT loop. User who wants to see it again must scroll out and back in.

### Install instructions (decision 4 — tier structure locked)

Three tiers reflecting honest 2026 state of MCP client support:

**Tier 1 — Works today, bearer token (primary):**
- Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows)
- Cursor (`~/.cursor/mcp.json`)
- Codex CLI (config path varies; brief snippet)
- Generic Streamable HTTP fallback (for Cline, Goose, Aider, any other compliant client)

**Tier 2 — Developer-only (OpenAI Responses API):**
- OpenAI Responses API JSON config (`{type: "mcp", server_label, server_url, allowed_tools, require_approval}`)
- Caveat that this is a developer integration, not a consumer install

**Tier 3 — Coming when OAuth ships:**
- Consumer ChatGPT (Apps & Connectors UI; OAuth-only per OpenAI policy)
- Explicit "Veto's bearer-token model doesn't connect here yet; OAuth is a planned future phase"

Each Tier 1 client gets:
- A name + 1-sentence "what this is" tagline
- An MCP URL line with a copy button (URL = `https://getvetoed.com/mcp`)
- A full JSON config block with a copy button (pre-filled with the user's actual bearer token IF they're logged in — this requires server-side rendering or a URL query param mechanism; otherwise show `Bearer pv_<your_token>` as a placeholder with a "get your token" link to the magic-link form)

### Evidence sample (decision 6 — content specified)

Real excerpt from `.planning/validation-runs/03-fomi-via-https.md`:

- Show Gate 3 (Platform & Big-Tech Risk) in full, including:
  - The DOK 1 facts (Apple Intelligence / Screen Time / Focus Mode references with tier S/A badges)
  - The DOK 2 summary
  - The DOK 3 insight ("Apple is moving toward focus as an OS primitive")
  - The gate verdict (FAIL)
- Below: a contradicting-evidence callout block showing that contradicting evidence WAS searched (the artifact contains this).
- This section earns the user's trust by showing actual output, not describing it.

Source-text comes from the captured artifact verbatim. Don't paraphrase. If a section is too long, truncate with explicit `[…]` markers, NEVER rewrite.

### Tools section (decision 3 — generation strategy)

Auto-extracted from code. Build-time script:

- New `scripts/generate-tools-section.ts` runs as part of `npm run build`.
- Walks `src/tools/*.ts` (excluding `*.test.ts`).
- For each tool, extracts: name, the `description` string from the `register*()` registerTool call's options object.
- Groups by which gate they serve (mapping derived from `src/resources/tool-to-gate-map.md`).
- Outputs a JSON manifest to `build/tools-manifest.json` and an HTML fragment to `build/tools-section.html`.
- The landing page's tools section uses the HTML fragment via a build-time include OR via a `<script>` that fetches the JSON manifest from the same origin.

Recommendation: build-time include is simpler. The landing page is itself generated/regenerated as part of the build pipeline.

### Email templates (decision 1 — restyle in scope)

Both `sendApprovalEmail` and `sendMagicLinkEmail` in `src/lib/email.ts` get their inline-styled HTML bodies rebuilt to match BRAND.md tokens:

- Background `#111210`
- Text `#F5F4F0` with secondary text at `rgba(245,244,240,0.55)`
- Accent `#D4F233` on CTAs
- DM Mono for the wordmark + CTA label + token display + code block
- Inter for body copy
- Token display: monospaced block on `#1A1A18` surface
- "Copy token from above" instruction line stays
- Contact line stays (`aljosa.sandbox@gmail.com`)
- Veto wordmark renders at the top in DM Mono

Email clients have wildly varying CSS support. Use ONLY:
- `<table>`-based layout (the most compatible)
- Inline `style=""` attributes (no `<style>` blocks for body styling, though some clients honor it for dark-mode hints)
- Web-safe fallback fonts in `font-family` (system stack with DM Mono / Inter as primary)
- No `position: absolute`, no flex/grid, no transforms, no animations

### Magic-link verification page (decision 1 — restyle in scope)

`src/http/magic-link-pages.ts` HTML strings (built in Phase 05a) get rebuilt to BRAND.md tokens:

- Inline `<style>` switching from old palette (cream + red accent) to BRAND.md tokens
- Dark mode only
- DM Mono wordmark
- Token display in monospaced block with copy button
- JSON config snippet with copy button
- Error pages (`missing_token` / `not_found` / `expired` / `already_used`) all restyled with BRAND.md tokens — error icon NOT used (no decorative elements), instead a thin status badge in semantic red `#FF6B55`

## Scope — what ships

### Stream A — Landing page
- A1: New `public/index.html` rebuilt from scratch using BRAND.md tokens. Sections per BRAND.md "Landing page specifics":
  1. Navigation (wordmark + Docs / GitHub / Install links — Install jumps to section 7)
  2. Hero (heading + sub + 2 CTAs + animation panel)
  3. Mechanism (5-gate sequence — copy adapted from `build-spec-v1.0.md` §3, tone aligned with BRAND.md voice rules)
  4. Evidence sample (real Fomi excerpt)
  5. Verdict math (fail-2 rule table)
  6. Anti-confirmation-bias callout (4 mechanisms tight list)
  7. Install (3-tier section with copy buttons)
  8. Tools (inline section, auto-extracted)
  9. Get access (magic-link form, BRAND-styled)
  10. Footer (wordmark + Built by Aljosa Makevic + LinkedIn + X — preserved from prior phase)
- A2: CSS file (or inline `<style>` block) implementing BRAND.md design tokens.
- A3: Hero animation CSS keyframes + Intersection Observer JS (small inline script).
- A4: Copy-button JS (small inline script using `navigator.clipboard`).
- A5: Build-time `scripts/generate-tools-section.ts` for auto-extracted tools section.
- A6: SEO meta + OG image (the OG image itself is out of scope for v1 — placeholder OK, but the meta tags + structured data ARE in scope).

### Stream B — Magic-link verification page restyle
- B1: Rebuild `src/http/magic-link-pages.ts` HTML (success + 4 error pages) with BRAND.md tokens.
- B2: Update test file `src/http/magic-link-verify.test.ts` if any assertion depends on specific palette colors (probably none, since tests check semantic content not styling).

### Stream C — Email template restyles
- C1: Rebuild `sendApprovalEmail` HTML body in `src/lib/email.ts` with BRAND.md tokens, table-based layout, inline styles.
- C2: Rebuild `sendMagicLinkEmail` HTML body with same patterns.
- C3: Plain-text bodies unchanged (already minimal; no styling concerns).

### Stream D — Tests + verification
- D1: Visual smoke — `npx html-validate public/index.html` exits 0.
- D2: Existing tests still pass (264 baseline; may need updates if any landing-page test asserts on old copy).
- D3: Smoke (`npm run smoke:http`) still exits 0.
- D4: `npx tsx scripts/assert-fomi-run.ts` still exits 0 with 6/6 PASS (Phase 01 inviolate).
- D5: Build pipeline (`npm run build`) generates `tools-section.html` correctly; landing page references it.

### Stream E — Docs
- E1: Update `docs/HOSTED_SETUP.md` to reflect the new install section structure (still relevant for direct-to-config users).
- E2: Update `.planning/codebase/CONCERNS.md` if any new concerns surface during execution.

## Out of scope (deferred)

- Admin dashboard restyle (decision 2 — Aljosa-only, lower priority).
- OAuth implementation (Phase 08 candidate — would unlock consumer ChatGPT install).
- A separate `/docs` page (decision 3 — inline section instead).
- WebGL or Lottie hero animation (decision 5 — medium fidelity locked).
- Light mode (decision 8 — skipped).
- Analytics integration (decision 14 — deferred).
- Sitemap (decision 15 — n/a for single-page).
- OG image asset creation (the image itself — placeholder OK; meta tags + structured data in scope).
- A11y deep audit beyond WCAG AA contrast + `prefers-reduced-motion` (a dedicated a11y phase could come later).

## Success criteria

- [ ] `public/index.html` rebuilt; opens cleanly; html-validate exits 0
- [ ] BRAND.md tokens applied throughout (verdict palette, DM Mono + Inter, dark theme, verdict stamp motif in 2 places, no decorative elements)
- [ ] Hero animation plays on scroll-into-view; respects `prefers-reduced-motion`
- [ ] Three-tier install section with copy buttons on URL + full JSON for each Tier 1 client
- [ ] Tools section auto-extracted from `src/tools/` at build time
- [ ] Real Fomi NO-GO excerpt shown as evidence sample (Gate 3 with DOK 1-3 layering visible)
- [ ] Magic-link verification page (success + 4 error pages) restyled with BRAND.md tokens
- [ ] Both email templates (approval + magic-link) restyled with BRAND.md tokens; render correctly in major email clients (Gmail / Apple Mail / Outlook)
- [ ] All 264 existing tests pass; new tests grow the count
- [ ] `npm run smoke:http` exits 0 (13 of 13 tools)
- [ ] `npx tsx scripts/assert-fomi-run.ts` exits 0 (6/6 PASS — Phase 01 inviolate)
- [ ] Copy buttons functional in modern browsers
- [ ] Mobile breakpoint at 768px works (no horizontal scroll on iPhone-size viewports)
- [ ] Live deploy verified: `curl https://getvetoed.com/` returns the restyled HTML
- [ ] CONCERNS.md updated if any concerns surfaced

## Constraints

- **Phase 01 inviolate (DO NOT TOUCH):** `src/validation/`, `src/lib/bias.ts`, `src/prompts/validate-idea.ts`, `src/tools/finalize-validation-report.ts`.
- **`assert-fomi-run.ts` and `scripts/smoke-http.ts` not modified.** Brand work is presentational; the framework's mechanical assertions are unchanged.
- **No new external dependencies** beyond what's strictly required for the build-time tools extraction. (No CSS framework, no React, no animation library.)
- **Atomic commits.** One per task. Build green after every commit.
- **BRAND.md is the authoritative source for every visual decision.** If a design choice can't be derived from BRAND.md, surface it as an open question rather than making it up.
- **The wordmark VETO is the logo. No logomark, no symbol.** (BRAND.md decision.)
- **Copy rules from BRAND.md must be enforced.** No "powerful," "insights," "AI-powered," "discover," "unlock." No soft verdict language. Verdicts are all-caps.

## Required reading for executor

1. **`BRAND.md`** (repo root) — the authoritative design + voice reference. Read all 364 lines. Every visual decision derives from here.
2. `.planning/phases/06-brand-landing-rebuild/PLAN.md` — task breakdown (this directory)
3. `.planning/spec/build-spec-v1.0.md` — §3 (5 gates copy source), §4 (tier + bias system referenced in evidence sample), §10 (Critical Test framing)
4. `.planning/validation-runs/03-fomi-via-https.md` — source for the evidence sample (specifically Gate 3 section)
5. `public/index.html` — current landing page (will be rebuilt; reference for what content survives)
6. `src/http/magic-link-pages.ts` — current verification page (will be restyled)
7. `src/lib/email.ts` — current email templates (both restyled)
8. `src/tools/*.ts` — registration patterns for auto-extracted tools section. Each tool's register call has a description.
9. `src/resources/tool-to-gate-map.md` — for grouping tools by gate in the tools section
10. `scripts/smoke-http.ts` + `scripts/assert-fomi-run.ts` — regression gates; should pass unchanged
