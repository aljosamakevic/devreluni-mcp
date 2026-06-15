# Phase 06 — Brand landing rebuild — PLAN

> **Author:** GSD planner, 2026-06-15
> **Spec basis:** CONTEXT.md (this directory), BRAND.md (repo root, locked v1)
> **Approval:** Aljosa locked scope + brand application defaults on 2026-06-15

---

## Task breakdown

**Total:** 18 atomic commits across 5 streams. Each task = one commit. Build green + 264 baseline tests still pass after each.

Complexity legend: **S** = ≤30 min, single file. **M** = 30-90 min, 1-3 files. **L** = 1-3 hours, cross-cutting.

---

### Stream A — Landing page (T01-T08)

Foundation stream. Most of Streams B/C/D's verifications depend on the landing existing.

#### T01 — Author CSS design tokens + base reset
- **Goal:** New file `public/css/tokens.css` (or inline in `<style>` block — executor chooses based on whether multi-file CSS is warranted for this size). Implements BRAND.md tokens as CSS custom properties:
  - `--bg: #111210`
  - `--surface: #1A1A18`
  - `--border: rgba(245, 244, 240, 0.10)`
  - `--border-emphasis: rgba(245, 244, 240, 0.20)`
  - `--text: #F5F4F0`
  - `--text-secondary: rgba(245, 244, 240, 0.55)`
  - `--text-tertiary: rgba(245, 244, 240, 0.30)`
  - `--text-muted: rgba(245, 244, 240, 0.18)`
  - `--accent: #D4F233`
  - `--status-fail: #FF6B55`
  - `--status-inconclusive: #FFB828`
  - Tier color palette as listed in BRAND.md "Tier color map"
  - Spacing scale (4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128px) as utility properties
  - Type scale variables (font sizes from BRAND.md table)
  - Border radius defaults (`--radius: 2px`)
  - Font-family stacks (`--font-mono: "DM Mono", ui-monospace, monospace; --font-body: "Inter", -apple-system, sans-serif`)
- **Files:** `public/css/tokens.css` (new) OR add a token block in inline style. Executor: prefer external file IF the landing CSS exceeds ~500 lines total; otherwise inline.
- **Acceptance:**
  - All BRAND.md color values represented as custom properties.
  - File validates (no syntax errors).
- **Dependencies:** none
- **Complexity:** S

#### T02 — Landing page HTML skeleton + navigation + footer
- **Goal:** Rebuild `public/index.html` from scratch with the 10-section structure from CONTEXT.md. This task lands ONLY the skeleton: navigation bar at the top (wordmark + Docs/GitHub/Install links — "Install" jumps to the install section anchor), an empty `<main>` with section landmarks, and the footer. All 10 sections appear as empty stubs with the correct headings; content lands in subsequent tasks.
- **Files:** `public/index.html` (rewrite, ~80 lines for skeleton).
- **Acceptance:**
  - 10 section anchors present: `#nav`, `#hero`, `#mechanism`, `#evidence`, `#verdict-math`, `#anti-bias`, `#install`, `#tools`, `#get-access`, `#footer`
  - Wordmark renders as `<span>VETO</span>` in DM Mono (per BRAND.md "The word is the logo").
  - Footer preserves "Built by Aljosa Makevic · LinkedIn · X" links from prior phase.
  - `npx html-validate public/index.html` exits 0.
- **Dependencies:** T01
- **Complexity:** M

#### T03 — Hero section: heading + sub + CTAs (static, no animation yet)
- **Goal:** Populate the hero section. Heading uses the BRAND.md hero pattern verbatim:

  ```
  Kill bad ideas
  [before] you
  build them.
  ```

  Where `[before]` is the accent word in `#D4F233` (acid yellow-green). Sub-heading: one line, max — pick the strongest from BRAND.md voice examples or write a fresh one passing the voice test ("Five gates. One verdict. No cheerleading." is the strongest of the examples). Two CTAs:
  - Primary: "Install the MCP" — button styled per BRAND.md "CTA button — primary" rules, jumps to `#install`
  - Secondary: "Read the docs" — text link styled per BRAND.md "CTA button — secondary" rules, jumps to `#mechanism`

  Hero is two-column on desktop (left = heading + sub + CTAs, right = empty placeholder for animation panel that T08 will fill). Single-column on mobile (animation panel below the CTAs).
- **Files:** `public/index.html` (extend hero section).
- **Acceptance:**
  - Hero copy exactly matches BRAND.md pattern; "before" is wrapped in a `<span class="accent">` with the correct color.
  - CTAs styled per BRAND.md rules.
  - Mobile + desktop layouts render without horizontal overflow at 375px and 1440px viewports (manual verification or Lighthouse / Chrome DevTools).
- **Dependencies:** T01, T02
- **Complexity:** M

#### T04 — Mechanism section (5-gate sequence)
- **Goal:** Render the 5 gates in the "Mechanism" section. Section eyebrow "MECHANISM" in DM Mono 10px tertiary text, +0.10em tracking. Heading "How it works." Below: a 5-step vertical layout (each step is a row with gate number, gate name, 1-sentence description). Numbered structure is appropriate here (BRAND.md says: "the gates are a genuine sequence").

  Content for each gate (drawn from `build-spec-v1.0.md` §3, tone-checked against BRAND.md voice rules):
  - G1 — Direct Competitor Scan — "Who is the closest existing thing, what have they shipped, where are they weak?"
  - G2 — Market Structure — "Is the market shaped so this idea can win meaningful share?"
  - G3 — Platform Risk — "Will a platform shift or hyperscaler ship this in 24 months?"
  - G4 — Willingness to Pay — "Will the target customer actually pay enough to make this a business?"
  - G5 — Why Now — "What changed in the last 24 months that makes this possible *now*?"

  Section MUST use DM Mono for the gate IDs and gate names, Inter for the descriptions. Tight, no decoration.
- **Files:** `public/index.html` (extend mechanism section).
- **Acceptance:**
  - 5 gates rendered in correct order.
  - Each gate has the locked copy (verbatim above).
  - Section passes BRAND.md voice rules (no "powerful," "insights," etc.).
- **Dependencies:** T01, T02
- **Complexity:** S

#### T05 — Evidence sample section (real Fomi excerpt)
- **Goal:** Render the evidence sample using the real Gate 3 excerpt from `.planning/validation-runs/03-fomi-via-https.md`. Read the artifact, find the Gate 3 section, render it in landing-page-appropriate density:
  - Section eyebrow "EVIDENCE" + heading "Real output."
  - DOK layer headers as eyebrows ("DOK 1 — FACTS", "DOK 2 — SUMMARY", "DOK 3 — INSIGHT") in DM Mono 10px.
  - DOK 1 facts as `<div class="fact-block">` rendered per BRAND.md "Evidence fact block" component spec.
  - Tier badges inline per BRAND.md "Tier color map" (S = yellow-green, A = blue, B = grey, etc.)
  - Gate 3 verdict rendered as a small inline stamp at the bottom (`FAIL` in `--status-fail` color, DM Mono, no rotation per BRAND.md inline stamp rules).
  - A "Contradicting evidence (searched)" callout below proving the anti-bias property fired.

  If the captured Gate 3 section is too long to fit (likely >800 words), truncate with `[…]` markers between DOK layers. Do NOT rewrite the source text.
- **Files:** `public/index.html` (extend evidence section).
- **Acceptance:**
  - Source text appears verbatim from the artifact (with explicit `[…]` truncations only).
  - At least 3 DOK 1 facts with tier badges visible (mix of S and A tier minimum).
  - The verdict stamp inline at end of section reads `FAIL` in semantic red.
  - Contradicting-evidence callout block present.
- **Dependencies:** T01, T02
- **Complexity:** L

#### T06 — Verdict math + anti-confirmation-bias sections
- **Goal:** Two tightly-coupled small sections.

  **Verdict math:** a `<table>` (NOT prose) showing the fail-2 rule from `build-spec-v1.0.md` §3.

  | Gate verdicts | Overall |
  |---|---|
  | 5 PASS | GO |
  | 4 PASS + 1 INCONCLUSIVE | CONDITIONAL GO |
  | 4 PASS + 1 FAIL | CONDITIONAL GO |
  | 3 PASS + 2 (FAIL or INC) | CONDITIONAL GO |
  | 2+ FAIL | NO-GO |

  Table styled per BRAND.md document layout rules. Section eyebrow "VERDICT MATH".

  **Anti-confirmation-bias callout:** a tight 4-item list of the structural anti-bias mechanisms:
  1. Every fact carries a quality tier (S/A/B/C/D) and bias flag.
  2. Contradicting evidence search is mandatory before any gate verdict.
  3. Three Validation Checks audit verdicts before they render.
  4. The Spiky POV section is blank — the framework never decides for the user.

  Eyebrow "ANTI-BIAS BY CONSTRUCTION".
- **Files:** `public/index.html` (extend both sections).
- **Acceptance:**
  - Verdict math table renders with correct rules (verbatim from spec).
  - Anti-bias callout has exactly 4 items.
- **Dependencies:** T01, T02
- **Complexity:** S

#### T07 — Install section (3-tier with copy buttons)
- **Goal:** Render the 3-tier install section per CONTEXT.md decision 11.

  **Tier 1 sub-sections, each with copy buttons:**

  - **Claude Desktop** — paths for macOS + Windows, full JSON config block with copy button, MCP URL line with separate copy button. Pre-filled placeholder bearer token (`pv_<your_token>`) with a "Get your token →" link to `#get-access` anchor.
  - **Cursor** — `~/.cursor/mcp.json` path, full JSON config block (Cursor's MCP config shape — verify shape vs Claude Desktop; both use similar structure).
  - **Codex CLI** — brief snippet (1-2 lines of CLI command or config path).
  - **Generic Streamable HTTP MCP** — URL + Authorization header snippet. Catch-all for Cline, Goose, Aider.

  **Tier 2 — OpenAI Responses API (developer):**
  - JSON snippet showing `{type: "mcp", server_label: "veto", server_url: "https://getvetoed.com/mcp", allowed_tools: [...], require_approval: "never"}`.
  - Caveat: "This is for developers using OpenAI's Responses API directly. Not a consumer ChatGPT install."

  **Tier 3 — Consumer ChatGPT (coming soon):**
  - One paragraph: "ChatGPT's Apps & Connectors UI requires OAuth for MCP servers. Veto's bearer-token model is on the roadmap to support OAuth — when it lands, this section will show the connect flow."

  Each Tier 1 copy button: vanilla JS using `navigator.clipboard.writeText` with `document.execCommand` fallback. Shows brief "Copied!" toast on success.
- **Files:** `public/index.html` (extend install section, ~200 lines).
- **Acceptance:**
  - 3 tiers visible.
  - Tier 1 has 4 client sub-sections.
  - Copy buttons present on URL + JSON for each Tier 1 client.
  - Copy buttons functional in modern browsers (manual smoke).
  - Section eyebrow "INSTALL".
- **Dependencies:** T01, T02
- **Complexity:** L

#### T08 — Hero animation (CSS keyframes + IntersectionObserver)
- **Goal:** Build the hero right-panel animation per CONTEXT.md decision 5.

  - HTML: a `<div id="hero-animation">` container in the hero section's right column with nested elements for each animation phase (5 gate slots, evidence rows, contradicting block, verdict stamp).
  - CSS keyframes implementing the 6-second sequence (timeline in CONTEXT.md).
  - JS: tiny IntersectionObserver that adds a `data-played` attribute to the container when it scrolls into view; CSS keyframes are gated by `[data-played="true"]`.
  - `@media (prefers-reduced-motion: reduce)`: skip keyframes, render end state immediately.
  - Animation does NOT loop.

  Use BRAND.md tokens throughout. Verdict stamp at the end renders `NO-GO` in `--status-fail` color with -8deg rotation.
- **Files:** `public/index.html` (extend hero — the animation HTML structure + inline `<style>` for keyframes + inline `<script>` for IntersectionObserver).
- **Acceptance:**
  - Animation plays once on scroll-into-view.
  - End state shows: 5 gate IDs labeled, evidence rows visible, contradicting evidence block, NO-GO verdict stamp rotated -8deg.
  - Reduced-motion preference renders end state immediately, no transitions.
  - No JS errors in browser console.
- **Dependencies:** T01, T02, T03
- **Complexity:** L

---

### Stream B — Tools section auto-extraction (T09-T10)

#### T09 — `scripts/generate-tools-section.ts`
- **Goal:** New build-time script that walks `src/tools/*.ts` (excluding `*.test.ts`), extracts the `description` field from each `register*()` call's options object via static AST parsing OR regex (executor choice), groups tools by which gate they serve (mapping from `src/resources/tool-to-gate-map.md`), outputs:
  - `build/tools-manifest.json` — structured manifest for potential future use
  - `build/tools-section.html` — HTML fragment with the rendered tools section

  HTML structure: a `<section>` block with eyebrow "13 TOOLS." Heading "Inside the framework." Then 5 sub-groupings (one per gate), each listing the tools that serve it. Each tool shows: name in DM Mono code-style, description in Inter body.

  Script integrated into `npm run build` via package.json scripts: `build` → `tsc && chmod ... && cp ... && tsx scripts/generate-tools-section.ts`.
- **Files:**
  - `scripts/generate-tools-section.ts` (new, ~150 lines)
  - `package.json` (extend `build` script)
- **Acceptance:**
  - Running `npm run build` generates `build/tools-section.html` with all 13 tools.
  - Each tool's description text matches what's in `src/tools/<tool>.ts`.
  - Tools are grouped by gate per `tool-to-gate-map.md`.
- **Dependencies:** none (parallel to landing tasks)
- **Complexity:** M

#### T10 — Wire generated tools section into landing
- **Goal:** The landing page references the generated HTML fragment. Options:
  - **A. Build-time include:** the build script reads `build/tools-section.html` and writes it directly into `build/index.html` (which Express serves via `express.static('build')` or wherever).
  - **B. Client-side fetch:** the landing page's tools section has a `<div id="tools-mount">` that a small JS snippet fills by fetching `/tools-section.html`.

  Option A is simpler and faster (one less HTTP request, no JS dep for content). Executor: use option A.

  Implement: the `scripts/generate-tools-section.ts` script also generates a final `build/index.html` (or `public/index.html` — pick one as the canonical served file) by reading `public/index.html` as a template and replacing a marker like `<!-- TOOLS_SECTION -->` with the rendered HTML.

  Update `src/http/server.ts` if necessary to serve `build/` instead of (or in addition to) `public/`. NOTE: Phase 03 wired `app.use(express.static('public'))`. If we switch to serving from `build/`, the magic-link verify page and admin static files need to come along too.

  Cleaner alternative: keep `public/` as the source, and the build script overwrites `public/index.html` in-place with the tools section filled in. The git-tracked `public/index.html` has the template marker; the built version has the rendered tools. `.gitignore` adjusted if needed.

  Actually cleanest: track `public/index.html` WITH the placeholder marker; build step overwrites it with the rendered version; the served file is always the rendered one. Re-rebuild is idempotent.
- **Files:**
  - `public/index.html` (add `<!-- TOOLS_SECTION -->` marker)
  - `scripts/generate-tools-section.ts` (extend to handle the template replacement)
  - `package.json` (build script order)
- **Acceptance:**
  - After `npm run build`, the `public/index.html` served by Express contains the rendered tools section with all 13 tools.
  - The git-tracked version of `public/index.html` (post-commit) contains either the placeholder OR the rendered version — pick one consistently. Executor: prefer the RENDERED version in git so deploy works without a build step (then build is idempotent, just regenerates the same content).
- **Dependencies:** T09, T07 (the section exists in skeleton)
- **Complexity:** M

---

### Stream C — Magic-link verification page restyle (T11-T12)

#### T11 — Restyle success page
- **Goal:** Rebuild the success-page HTML in `src/http/magic-link-pages.ts` with BRAND.md tokens. Same content as Phase 05a (token display + copy button + JSON config + Claude Desktop instructions), restyled:
  - Dark theme: `#111210` bg, `#F5F4F0` text
  - Wordmark "VETO" in DM Mono at top
  - "You're in" headline in DM Mono (smaller than the hero's main heading, but using the same family)
  - Token display in `<code>` block on `--surface` background
  - Copy button in BRAND.md primary CTA style
  - JSON config in `<pre>` block on `--surface` background with its own copy button
  - Footer link back to https://getvetoed.com/ in tertiary text color
- **Files:** `src/http/magic-link-pages.ts` (rewrite success-page HTML string).
- **Acceptance:**
  - Existing test `src/http/magic-link-verify.test.ts` still passes (assertions are on semantic content, not palette).
  - Manual smoke: deploy to local server, request a magic link, click the verify link, verify the page renders with BRAND.md styling.
- **Dependencies:** none (separate file from landing)
- **Complexity:** M

#### T12 — Restyle 4 error pages
- **Goal:** Rebuild the 4 error pages (`missing_token`, `not_found`, `expired`, `already_used`) in `src/http/magic-link-pages.ts` with BRAND.md tokens. Same content as Phase 05a (friendly error + "Request a new sign-in link" CTA), restyled. No icons (no decorative elements per BRAND.md). Use a small status badge in `--status-fail` color as the only visual signal.
- **Files:** `src/http/magic-link-pages.ts` (rewrite error-page HTML strings).
- **Acceptance:**
  - All 4 error pages render with BRAND.md styling.
  - Existing test assertions still pass.
- **Dependencies:** T11 (same file)
- **Complexity:** S

---

### Stream D — Email template restyles (T13-T14)

#### T13 — Restyle approval email
- **Goal:** Rebuild the HTML body of `sendApprovalEmail` in `src/lib/email.ts` using BRAND.md tokens but constrained to email-client-safe CSS. Use:
  - `<table>`-based layout (NOT divs with flexbox)
  - Inline `style=""` attributes only (no `<style>` blocks for body styling)
  - Web-safe font fallback in `font-family`
  - Hardcoded color values (no CSS custom properties — email clients don't support them)
  - Background: `#111210`, text: `#F5F4F0`
  - VETO wordmark at top in DM Mono (with system mono fallback)
  - Token display in monospaced block on `#1A1A18` surface
  - Optional admin-note block (existing feature from Phase 04) kept; restyled with BRAND.md surface
  - CTA button (the "Try it" or "Get started" link to docs) in `#D4F233` background with `#111210` text — BRAND.md primary CTA shape
  - Contact line + noreply note preserved (recent commit `4f475af`)
- **Files:** `src/lib/email.ts` (rewrite `buildApprovalHtmlBody` function).
- **Acceptance:**
  - Test `src/lib/email.test.ts` still passes (assertions on semantic content, not exact HTML).
  - Manual smoke: send a test email via Resend's dashboard "send test" feature or a one-off Node script, verify rendering in Gmail, Apple Mail (if available locally).
- **Dependencies:** none (separate file from landing)
- **Complexity:** M

#### T14 — Restyle magic-link email
- **Goal:** Same restyle treatment for the HTML body of `sendMagicLinkEmail` in `src/lib/email.ts`. The CTA button is the magic link itself — styled per BRAND.md primary CTA rules. Plain-text body unchanged.
- **Files:** `src/lib/email.ts` (rewrite `buildMagicLinkHtmlBody` function).
- **Acceptance:**
  - Test still passes.
  - Manual smoke OK.
- **Dependencies:** T13 (same file)
- **Complexity:** S

---

### Stream E — Docs + verification (T15-T18)

#### T15 — Update `docs/HOSTED_SETUP.md`
- **Goal:** Update HOSTED_SETUP.md to reflect the new install section structure. Replace the existing onboarding-via-form copy with: "Most users get access via https://getvetoed.com/ — enter your email, click the link, paste the token. This document is for direct CLI config." Then the existing config snippets stay, with Cursor + Codex CLI added.
- **Files:** `docs/HOSTED_SETUP.md`.
- **Acceptance:**
  - Doc reflects current onboarding flow.
  - Cursor + Codex CLI config sections added.
- **Dependencies:** T07 (the landing install section is the canonical reference)
- **Complexity:** S

#### T16 — SEO meta tags + structured data
- **Goal:** Add `<head>` meta tags to `public/index.html`:
  - `<title>` (already present, verify content matches BRAND.md voice rules)
  - `<meta name="description">` 1-line, voice-rule-compliant
  - `<meta property="og:title">`, `<meta property="og:description">`, `<meta property="og:image">` (placeholder URL OK — actual image is out of scope for v1)
  - `<meta name="twitter:card" content="summary_large_image">`
  - JSON-LD `<script type="application/ld+json">` block with `Application` schema:
    ```json
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "name": "Veto",
      "applicationCategory": "BusinessApplication",
      "description": "<voice-rule-compliant description>",
      "url": "https://getvetoed.com/"
    }
    ```
- **Files:** `public/index.html` (extend `<head>`).
- **Acceptance:**
  - All meta tags present.
  - JSON-LD parses correctly via `python3 -c "import json; json.load(open('build/jsonld.tmp'))"` or similar smoke.
- **Dependencies:** T02
- **Complexity:** S

#### T17 — Smoke + verification gate (existing tests pass)
- **Goal:** No new code. Verification gate:
  1. `npm run build` succeeds and generates `build/index.html` with rendered tools section.
  2. `npm test` exits 0 with 264+ tests passing.
  3. `npm run smoke:http` exits 0 with "13 of 13 tools listed via HTTP".
  4. `npx tsx scripts/assert-fomi-run.ts` exits 0 with 6/6 PASS.
  5. `npx html-validate public/index.html` exits 0.
  6. Open the landing page in a browser (or use curl + visual inspection of HTML structure) and verify all 10 sections render in correct order.

  Empty commit (`git commit --allow-empty`) records the verification in the commit message.
- **Files:** none.
- **Acceptance:** All 6 verifications green.
- **Dependencies:** T01-T16
- **Complexity:** S

#### T18 — Live deploy verification (post-merge, optional)
- **Goal:** After PR merge + CI deploy lands, manually verify:
  - `curl https://getvetoed.com/` returns the rebuilt HTML
  - Hero animation works in a browser
  - Install section copy buttons work
  - Magic-link form still works (Phase 05a regression)
  - Submit a test magic link, verify the verification page renders with BRAND.md styling
  - Approve a test signup, verify the email renders with BRAND.md styling

  This task is post-merge and lives outside the PR. It's listed here so the executor doesn't think the work is finished at PR open.
- **Files:** none (verification only).
- **Acceptance:** All 6 manual smokes pass on the live deploy.
- **Dependencies:** PR merged, CI deployed
- **Complexity:** S (but human-gated)

---

## Dependency graph

```
Stream A (Landing — sequential, single file)
  T01 (CSS tokens) ──▶ T02 (skeleton) ──▶ T03 (hero static)
                                     ├──▶ T04 (mechanism)
                                     ├──▶ T05 (evidence sample)
                                     ├──▶ T06 (verdict math + anti-bias)
                                     ├──▶ T07 (install)
                                     └──▶ T08 (hero animation, after T03)

Stream B (Tools section — parallel with Stream A)
  T09 (generate script) ──▶ T10 (wire into landing, after T07)

Stream C (Magic-link page — parallel)
  T11 (success) ──▶ T12 (errors)

Stream D (Emails — parallel)
  T13 (approval) ──▶ T14 (magic link)

Stream E (Docs + verification)
  T15 (HOSTED_SETUP.md, after T07)
  T16 (SEO, after T02)
  T17 (verification gate, after all above)
  T18 (live deploy, after PR merged)
```

**Critical path:** T01 → T02 → T07 → T10 → T17 (5 sequential steps in the landing-section thread).

**Parallel-execution-safe groupings:**
- After T02: T03, T04, T05, T06, T07, T09, T11, T13 can all run in parallel — none of them touch the same file.
- After T07: T08, T10, T15, T16 can run in parallel.

Executor: serialize for simplicity. Per-task commit cadence dominates the time budget regardless.

---

## Risks & mitigations

### R1: Hero animation looks bad on mobile or low-end devices
**Concern:** CSS keyframe sequence + IntersectionObserver should be lightweight, but if the animation drops below 30fps or scrolls jankily on a 3G mobile device, it hurts trust ("if their landing page is janky, what about their actual product?").

**Mitigation:**
- Use only `transform` and `opacity` keyframes (GPU-accelerated; no layout thrash).
- `prefers-reduced-motion: reduce` renders end state immediately.
- Mobile breakpoint at 768px: animation panel stacks below CTAs and uses a simpler 4-second sequence (or skips entirely on width < 480px).
- Manual smoke on a real phone before T18 verification.

### R2: Email rendering varies wildly across clients
**Concern:** Gmail's web client, Apple Mail, Outlook 2016, Outlook web — all interpret HTML differently. Inline styles + tables are safest but not bulletproof. Restyle could look great in Apple Mail and broken in Outlook.

**Mitigation:**
- Stick to a minimal subset of HTML email best practices: tables, inline styles, web-safe fonts.
- Test in 3 clients before T18: Gmail web, Apple Mail (Aljosa's primary), Outlook web (a common corporate path).
- Plain-text fallback is preserved (`buildApprovalTextBody` etc.).
- If something looks broken in Outlook specifically, accept it for v1 and document — Outlook is ~15% of email opens for technical audiences and the plain-text fallback works there.

### R3: Tools section auto-extraction misses metadata in some tools
**Concern:** The 13 tools were registered across 3 phases by different authors (Phase 00 / Phase 01 / Phase 02). Their `description` strings vary in tone and length. A naive auto-extract could produce inconsistent landing-page copy.

**Mitigation:**
- T09 includes a post-extraction normalization step: if a description exceeds 120 characters, truncate with `…`. If it's under 30, log a warning (Aljosa can hand-edit the registration call before the next build).
- The build-time script outputs a summary of any tools with anomalous metadata to stdout so the executor can flag them in the commit message.
- The tool-to-gate map (`src/resources/tool-to-gate-map.md`) is the source of truth for grouping; the script logs a warning if any tool isn't mapped to a gate.

### R4: Evidence sample (Gate 3 excerpt) is too long for the landing
**Concern:** The captured Fomi NO-GO is 6111 words. Gate 3 specifically might be ~1500 words. A landing-page section that's 1500 words of dense evidence interrupts the scroll flow.

**Mitigation:**
- T05 truncates aggressively. Show DOK 1 (the facts) in full, DOK 2 / DOK 3 with explicit `[…]` markers indicating elision.
- Aim for ~400 words visible in the evidence section. Provide a "Read the full report →" link that points to the captured artifact (could be served as `/sample-report.html` or linked to the GitHub raw).
- The verdict stamp inline at the end of the section is the visual anchor — it's what stays in memory regardless of how much body text is read.

### R5: BRAND.md and live behavior drift
**Concern:** A future tweak to BRAND.md doesn't propagate to the landing. Or vice versa: the executor reinterprets BRAND.md and the landing diverges from the canonical brand.

**Mitigation:**
- All BRAND.md tokens encoded as CSS custom properties at T01. Any future BRAND.md change updates `--accent` (etc.) in ONE place.
- T01 acceptance grep-locks the BRAND.md color values present in the CSS. A future BRAND.md change that misses the propagation would fail this grep.
- Email styles can't use CSS custom properties (email-client constraint), so they're hardcoded. Risk documented; future BRAND.md change requires touching 2 places (CSS + email HTML).

---

## Definition of Done

- [ ] Landing page rebuilt with all 10 BRAND.md-compliant sections. → **T02-T08, T16**
- [ ] BRAND.md design tokens encoded as CSS custom properties. → **T01**
- [ ] Hero accent word "before" rendered in `#D4F233`. → **T03**
- [ ] Hero animation plays on scroll-into-view; respects `prefers-reduced-motion`. → **T08**
- [ ] Install section has 3 tiers; Tier 1 has 4 clients with copy buttons on URL + JSON. → **T07**
- [ ] Tools section auto-extracted from `src/tools/*.ts`; all 13 tools listed grouped by gate. → **T09, T10**
- [ ] Real Gate 3 excerpt from `03-fomi-via-https.md` rendered as evidence sample with tier badges + verdict stamp. → **T05**
- [ ] Magic-link verification page (success + 4 errors) restyled with BRAND.md tokens. → **T11, T12**
- [ ] Both email templates restyled with BRAND.md tokens, table-based layout, inline styles. → **T13, T14**
- [ ] SEO meta tags + JSON-LD structured data present. → **T16**
- [ ] `docs/HOSTED_SETUP.md` reflects current onboarding. → **T15**
- [ ] `html-validate public/index.html` exits 0. → **T17**
- [ ] All existing tests pass (264+ growing). → **T17**
- [ ] `npm run smoke:http` exits 0 (13 of 13 tools). → **T17**
- [ ] `npx tsx scripts/assert-fomi-run.ts` exits 0 (6/6 PASS — Phase 01 inviolate). → **T17**
- [ ] Phase 01 inviolate files NOT touched. → **all tasks**
- [ ] Live deploy verified (post-merge): canonical URL renders rebuilt HTML, animation works, copy buttons work, magic-link round-trip works with restyled pages. → **T18**

---

## Out of Scope (restated)

- Admin dashboard restyle
- OAuth implementation (separate phase candidate)
- `/docs` page (inline section instead)
- WebGL/Lottie hero animation
- Light mode
- Analytics integration
- Sitemap
- OG image asset creation (placeholder URL OK)
- Deep a11y audit (WCAG AA contrast + reduced-motion only)

---

*Phase 06 plan. 18 atomic commits across 5 streams. Critical path 5 tasks. Ready for execution.*
