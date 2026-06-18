// Generates public/og.png — the 1200x630 Open Graph / social-share card for
// getvetoed.com. The landing page <head> already references /og.png (og:image
// + twitter:image, declared 1200x630); this script produces that file.
//
// Design follows BRAND.md: near-black warm background, DM Mono everywhere
// (the wordmark and all type are monospace), the hero heading with the accent
// landing on "before", the one-line sub, and a NO-GO verdict stamp as a
// rotated background watermark (the "hero watermark" treatment, 15-20% opacity).
//
// Run: node scripts/generate-og.mjs  (regenerate whenever the card copy changes)

import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fontDir = join(here, 'og-assets');
const outPath = join(here, '..', 'public', 'og.png');

// BRAND.md tokens.
const BG = '#111210';        // background, near-black warm
const INK = '#F5F4F0';       // text primary, off-white
const ACCENT = '#D4F233';    // verdict accent, acid yellow-green
const NOGO = '#FF6B55';      // NO-GO / FAIL status red
const SECONDARY = 'rgba(245,244,240,0.55)';
const TERTIARY = 'rgba(245,244,240,0.30)';
const BORDER = 'rgba(245,244,240,0.10)';

// All copy is straight from the landing page so the share card matches the page.
const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="${BG}"/>

  <!-- NO-GO verdict stamp, rotated, as a background watermark (hero treatment). -->
  <g opacity="0.15" transform="rotate(-8 952 322)">
    <rect x="757" y="232" width="390" height="180" rx="2" fill="none" stroke="${NOGO}" stroke-width="5"/>
    <text x="952" y="375" text-anchor="middle"
          font-family="DM Mono" font-weight="500" font-size="118"
          letter-spacing="-2" fill="${NOGO}">NO-GO</text>
  </g>

  <!-- Top rule + wordmark + url -->
  <text x="72" y="96" font-family="DM Mono" font-weight="500" font-size="30"
        letter-spacing="-0.6" fill="${INK}">VETO</text>
  <text x="1128" y="96" text-anchor="end" font-family="DM Mono" font-weight="400"
        font-size="18" letter-spacing="0.4" fill="${TERTIARY}">getvetoed.com</text>
  <line x1="72" y1="124" x2="1128" y2="124" stroke="${BORDER}" stroke-width="1"/>

  <!-- Eyebrow -->
  <text x="72" y="232" font-family="DM Mono" font-weight="400" font-size="15"
        letter-spacing="1.5" fill="${TERTIARY}">MCP SERVER &#183; STRUCTURED PRODUCT-IDEA VALIDATION</text>

  <!-- Hero heading. Accent lands on "before". -->
  <g font-family="DM Mono" font-weight="500" font-size="62" letter-spacing="-1.8" fill="${INK}">
    <text x="72" y="318">Kill bad ideas</text>
    <text x="72" y="392"><tspan fill="${ACCENT}">before</tspan> you</text>
    <text x="72" y="466">build them.</text>
  </g>

  <!-- One-line sub -->
  <text x="72" y="548" font-family="DM Mono" font-weight="400" font-size="25"
        letter-spacing="-0.3" fill="${SECONDARY}">Five gates. One verdict. No cheerleading.</text>
</svg>`;

const resvg = new Resvg(svg, {
  background: BG,
  fitTo: { mode: 'width', value: 1200 },
  font: {
    loadSystemFonts: false,
    fontFiles: [
      join(fontDir, 'DMMono-Regular.ttf'),
      join(fontDir, 'DMMono-Medium.ttf'),
    ],
    defaultFontFamily: 'DM Mono',
  },
});

const png = resvg.render().asPng();
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes)`);
