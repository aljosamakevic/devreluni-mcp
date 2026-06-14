# BRAND.md — Veto

> This file is the authoritative design reference for any Veto landing page, slide deck, or UI surface. Design agents and code agents must read it before producing any output. Every visual decision must be derivable from this document. When in doubt, do less.

---

## What Veto is

An MCP server that validates product ideas across five structured gates — returning GO / NO-GO / CONDITIONAL GO verdicts backed by source-grounded evidence.

**The core proposition:** Kill bad ideas *before* you build them.

**Target user:** Solopreneurs and small builder teams (1–5 people) evaluating ideas before committing build time.

**Form factor:** CLI-native (Claude Desktop, Cursor, Claude Code). Technical users who will install an MCP server.

---

## Personality

Veto is a skeptical counterparty, not an assistant. It argues against ideas. It produces evidence, not encouragement. It respects the user's intelligence.

**Adjectives that fit:** Rigorous, adversarial, precise, blunt, credible, un-polished.

**Adjectives that do not fit:** Friendly, warm, empowering, motivating, delightful, playful.

**Voice examples:**

| Wrong | Right |
|---|---|
| "We found some concerns around platform risk." | "Your idea failed Gate 3." |
| "AI-powered validation for modern founders." | "Five gates. One verdict. No cheerleading." |
| "Uncover powerful market insights." | "Sourced evidence. Biased facts labeled." |
| "Your co-pilot for idea validation." | "The NO before the build." |

**Hero heading accent:** The highlighted word is *"before"* — rendered in `#D4F233`. Not "build them", not "bad ideas". The accent lands on the temporal interruption: you're stopping something before it happens. That's the product's core claim in one word.

```
Kill bad ideas
[before] you        ← accent here
build them.
```

**Copy rules:**
- Short sentences. Active voice. Present tense.
- Name things by what they do, not what they feel like.
- Never use: "powerful," "seamless," "unlock," "supercharge," "game-changer," "insights at your fingertips."
- Verdicts are stated, not softened. "FAIL" not "Room for improvement."
- Technical precision is a feature, not a barrier. Don't dumb it down.

---

## Logo / wordmark

**Wordmark:** `VETO` in DM Mono, weight 500, all caps, letter-spacing –0.02em.

**Treatment rules:**
- Always monospace. Never set in a sans or serif.
- Never add a logomark, icon, or symbol. The word is the logo.
- On dark: `#F5F4F0` fill.
- On light: `#111210` fill.
- Minimum size: 14px. Do not scale below this.
- Do not add drop shadows, gradients, or outlines.

---

## Color

**Background (primary):** `#111210` — near-black with a warm cast. Not pure black.

**Surface (secondary):** `#1A1A18` — used for inset areas, code blocks, subtle section backgrounds.

**Border:** `rgba(245, 244, 240, 0.10)` — almost invisible rule lines. Default for dividers and card borders.

**Border emphasis:** `rgba(245, 244, 240, 0.20)` — hover states, focused inputs.

**Text primary:** `#F5F4F0` — off-white, slightly warm. Never pure white.

**Text secondary:** `rgba(245, 244, 240, 0.55)` — body copy, descriptions.

**Text tertiary:** `rgba(245, 244, 240, 0.30)` — labels, eyebrows, metadata.

**Text muted:** `rgba(245, 244, 240, 0.18)` — disabled states, timestamps.

**Verdict / accent:** `#D4F233` — acid yellow-green. The single accent color. Used ONLY for:
- GO verdict text and borders
- Gate pass indicators
- Active highlights and selection states
- The wordmark on dark when used in a stamp context

**Status colors (semantic only — not decorative):**
- PASS / GO: `#D4F233` text, `rgba(212, 242, 51, 0.10)` background
- FAIL / NO-GO: `#FF6B55` text, `rgba(255, 107, 85, 0.10)` background
- INCONCLUSIVE / CONDITIONAL GO: `#FFB828` text, `rgba(255, 184, 40, 0.10)` background

**Rules:**
- The accent yellow is never used as a background fill. Only as text or border.
- Never introduce additional accent colors. One accent. One brand.
- No gradients. No color-to-color transitions. Flat surfaces only.
- Light mode is not the primary mode. If you must implement light mode, invert: `#F5F4F0` background, `#111210` text, same accent.

---

## Typography

**Display / monospace:** DM Mono
- Google Fonts: `https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap`
- Used for: wordmark, headings, gate IDs, verdicts, code, labels, eyebrows.
- Weight: 400 (regular), 500 (medium). Never bold (700) — too heavy against the dark bg.
- Letter-spacing: –0.02em to –0.03em on large headings. +0.08em to +0.12em on all-caps labels.

**Body / sans:** Inter
- Google Fonts: `https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap`
- Used for: body copy, descriptions, longer explanatory text.
- Weight: 400 (regular), 500 (medium).
- Letter-spacing: –0.01em at body size.

**Type scale:**

| Role | Family | Size | Weight | Tracking |
|---|---|---|---|---|
| Hero heading | DM Mono | 40–56px | 500 | –0.03em |
| Section heading | DM Mono | 24–32px | 500 | –0.02em |
| Sub-heading | DM Mono | 18–20px | 400 | –0.01em |
| Body | Inter | 15–16px | 400 | –0.01em |
| Body small | Inter | 13–14px | 400 | 0 |
| Label / eyebrow | DM Mono | 10–11px | 400 | +0.10em |
| Verdict stamp | DM Mono | 48–80px | 500 | –0.03em |
| Gate ID | DM Mono | 9–11px | 400 | +0.08em |
| Monospace data | DM Mono | 12–13px | 400 | 0 |

**Rules:**
- Headings are always DM Mono.
- Labels and eyebrows are always DM Mono all-caps with positive tracking.
- Do not use sentence-case for verdicts (GO, NO-GO, CONDITIONAL GO, PASS, FAIL, INCONCLUSIVE are always all-caps).
- Line height: 1.1 for display, 1.4 for sub-headings, 1.65 for body.

---

### Hero visual pattern

The hero right panel is a **live validation run** — not a stamp, not a screenshot, not an illustration. It shows the product executing: gate IDs appearing, sources with tier badges, flags firing, validation checks completing, and the verdict dropping at the end. This plays automatically on scroll-into-view.

Layout: two-column split. Left = static (heading, sub, CTAs). Right = animated terminal panel with gate status row and verdict bar at the bottom.

The stamp motif (large rotated GO / NO-GO text) is reserved for individual report headers and slide verdict screens — not the hero. The hero earns attention through motion and evidence, not graphic weight.

### The stamp — signature element

The visual identity centers on a **verdict stamp**: a heavy monospaced text block (GO / NO-GO / CONDITIONAL GO) inside a tight border, slightly rotated, that appears on reports, hero sections, and as a recurring motif.

**Stamp construction:**
```
border: 3–4px solid [status color]
border-radius: 2px
padding: 6px 16px
font-family: DM Mono
font-size: 56–80px (hero use) / 20–28px (inline use)
font-weight: 500
letter-spacing: –0.02em
color: [status color]
transform: rotate(–6deg to –10deg)
```

**Usage:**
- Hero section: large, rotated, 15–20% opacity as background watermark.
- Report header: medium, rotated, full opacity, placed in the top-right.
- Inline within gate blocks: small, no rotation, full opacity, inline with verdict text.

**Rules:**
- The stamp color always matches verdict status (yellow = GO, red = NO-GO, amber = CONDITIONAL GO).
- Never use the stamp decoratively with generic text. Only real verdict states.
- Never fill the stamp background.

---

## Layout principles

**Grid:** 12-column, 1200px max-width, 32px gutters on desktop. 16px gutters on mobile.

**Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128px. No arbitrary values.

**Structure is information.** Use dividing rules (0.5px, border color), section numbering (only when content is genuinely sequential), and tight labeling. Every structural element must earn its place by encoding something true about the content.

**Document layout, not dashboard layout.** Content flows vertically in clearly delimited sections, like an audit report. Do not use card grids with equal-weight items unless comparing parallel things (e.g., gate status cards).

**Border radius:** 2px for interactive elements and containers (not 4px, not 8px). Veto is not rounded. The exception: `1px` for status badges, `0` for stamp borders.

**No decorative elements.** No background illustrations, no abstract shapes, no icons as decoration. Structure carries all visual weight.

---

## Component patterns

### Gate status card

```
border: 0.5px solid rgba(245,244,240,0.10)
border-radius: 2px
padding: 10px 8px
background: transparent
```

Contents (top to bottom):
1. Gate ID — DM Mono 10px, tertiary text, tracking +0.08em (e.g., `G1`)
2. Gate name — Inter 11px, secondary text, 1.3 line height
3. Status badge — DM Mono 10px, status color background + text, padding 3px 6px, radius 1px

### Verdict bar

Full-width, sits below gate cards. Thin border in accent color (for GO), status color for others.

```
border: 0.5px solid [status-color at 30% opacity]
background: [status-color at 4% opacity]
border-radius: 2px
padding: 16px 20px
display: flex
align-items: center
justify-content: space-between
```

Contents: verdict label (eyebrow) + verdict value (large DM Mono) on the left; confidence level on the right.

### Evidence fact block (DOK 1)

Monospaced, tight, dense. Treat like compiler output.

```
font-family: DM Mono
font-size: 12px
color: rgba(245,244,240,0.65)
border-left: 2px solid rgba(245,244,240,0.12)
padding-left: 12px
margin: 8px 0
```

Tier badge inline: small all-caps label, background colored per tier (see tier color map below).

### Tier color map

| Tier | Background | Text |
|---|---|---|
| S | rgba(212,242,51,0.12) | #D4F233 |
| A | rgba(99,195,255,0.12) | #7DC8FF |
| B | rgba(150,150,130,0.15) | #AAAAAA |
| C | rgba(255,184,40,0.10) | #FFB828 |
| D | rgba(255,107,85,0.10) | #FF6B55 |

### Section eyebrow

DM Mono, 10–11px, all-caps, tracking +0.10em, tertiary text color. Always placed above section heading. No decoration.

```
Validation run — AI-native focus app — B2C / solo
```

---

## Slide deck specifics

When building slides (e.g., for Keynote / PowerPoint export or a Reveal.js-style web deck):

**Slide dimensions:** 1920×1080px (16:9).

**Background:** `#111210` on all slides. No background variations between slides.

**Slide types:**

1. **Title slide** — Wordmark top-left. Hero heading centered. Tagline below. NO-GO stamp watermark rotated in background at 8% opacity.
2. **Content slide** — Section eyebrow top-left. Heading below. Body content in 2-column layout (label column left, content column right) for dense information.
3. **Gate status slide** — Five gate cards in a row, verdict bar below. No prose on this slide.
4. **Evidence slide** — Single gate. DOK layer header (DOK 1 / DOK 2 / DOK 3 / DOK 4) as eyebrow. Content in that layer below. Contradicting evidence block at the bottom.
5. **Verdict slide** — Full-bleed stamp (rotated, full opacity), small verdict details below.

**Slide padding:** 80px all sides. Consistent across all slides.

**Transitions:** Cut only. No animations. No slide-in effects.

---

## Landing page specifics

**Page structure (sections in order):**

1. **Navigation** — Wordmark left. Links right (Docs, GitHub, Install). Thin bottom border.
2. **Hero** — "Kill bad ideas *before* you build them." heading — accent color on "before", not "build them". One-line sub. Live validation run animation (terminal + gate sequence) as the hero visual. Two CTAs: "Install the MCP" (primary) and "Read the docs" (text link).
3. **Mechanism** — "How it works." Five-gate sequence. This is the only place numbered structure is appropriate (the gates are a genuine sequence).
4. **Evidence sample** — A real (or realistic) gate output block showing DOK layering. Prove it works by showing the output, not describing it.
5. **Verdict math** — The fail-2 rule, explained in a table. Not prose.
6. **Anti-confirmation-bias callout** — The four mechanisms that make bias structurally impossible. Tight list.
7. **Install** — `npx install veto-mcp` or equivalent. Code block. Nothing else on this section.
8. **Footer** — Wordmark. Links. No padding.

**CTA button — primary:**
```
background: #D4F233
color: #111210
font-family: DM Mono
font-size: 13px
font-weight: 500
letter-spacing: 0.04em
padding: 10px 20px
border-radius: 2px
border: none
text-transform: uppercase
```

**CTA button — secondary / text:**
```
background: transparent
color: rgba(245,244,240,0.55)
font-family: DM Mono
font-size: 13px
letter-spacing: 0.04em
padding: 10px 20px
border: 0.5px solid rgba(245,244,240,0.15)
border-radius: 2px
```

---

## What NOT to do

A complete list of anti-patterns. Reject any design output that includes these:

- Gradient backgrounds or text
- Rounded corners above 4px
- Decorative icons or illustrations
- The color blue as an accent (reserved for tier-A badges only)
- Purple, teal, coral, or any multi-accent palette
- Animations on landing page (no hero scroll effects, no entrance animations)
- Card grids with equal visual weight — hierarchy must be explicit
- Soft status language ("Inconclusive" → never "Needs more research")
- The word "insights," "powerful," "AI-powered," "discover," or "unlock"
- Navigation items beyond: Docs / GitHub / Install
- A hero subheading longer than one line
- The verdict stamp used as decoration (must only appear with a real verdict state)
- Images or photography
- Social proof sections ("Loved by X founders") — no social proof in v1
- Modal overlays or pop-ups on the landing page
- A light mode unless specifically requested

---

## Design checklist

Before shipping any page or slide, verify:

- [ ] DM Mono used for all headings, labels, verdicts, IDs, eyebrows
- [ ] Inter used for all body copy only
- [ ] No color other than: `#111210`, `#1A1A18`, `#F5F4F0` variants, `#D4F233`, `#FF6B55`, `#FFB828`, tier badge colors
- [ ] Border radius 2px or less on all elements
- [ ] No gradients anywhere
- [ ] Verdict stamp only appears with a real verdict state (GO / NO-GO / CONDITIONAL GO)
- [ ] Status colors match verdict math (yellow = GO, red = NO-GO, amber = CONDITIONAL GO)
- [ ] Copy passes the "wrong / right" voice test from the Personality section
- [ ] No decorative or illustrative elements
- [ ] Section eyebrows present above all headings
- [ ] Typography hierarchy: DM Mono display > DM Mono sub > Inter body > DM Mono label

---

*End of BRAND.md — Veto v1.0*
