// T-V03 — Regression guard for CONCERNS.md M1: extractPriceTiers must REQUIRE
// a currency anchor before treating digits as a price. Prior to the M1 fix the
// regex matched bare digit runs and pulled HTML entity remnants ("&#8217;") and
// CSS class fragments ("col-474") into the tiers array — a fabrication source.
//
// The current regex is:
//   /[\$€£¥]\s*\d+(?:[.,]\d+)?(?:\s*\/\s*(?:mo(?:nth)?|yr|year|user|seat))?/gi
//
// Plus a separate "Free tier" / "Free" literal-sentinel branch. These tests
// pin BOTH branches so a future "loosen the regex" attempt fails loudly.

import { describe, expect, it } from 'vitest';
import { extractPriceTiers } from './find-pricing-anchors.js';

describe('extractPriceTiers — currency-anchored regex (M1 regression guard)', () => {
  it('extracts USD month + year pricing', () => {
    const tiers = extractPriceTiers('Get focus mode for $9.99/month or $99/year');
    expect(tiers).toContain('$9.99/month');
    expect(tiers).toContain('$99/year');
  });

  it('supports Euro and GBP currency anchors', () => {
    const tiers = extractPriceTiers('€15/mo premium, £10/mo basic');
    expect(tiers).toContain('€15/mo');
    expect(tiers).toContain('£10/mo');
  });

  it('extracts one-time lifetime pricing without per-period suffix', () => {
    const tiers = extractPriceTiers('$199 lifetime deal');
    expect(tiers).toContain('$199');
  });

  it('extracts per-user / per-seat pricing variants', () => {
    // Regex allows ONE optional "/ <unit>" segment; "$25 / user" matches with
    // user as the unit. "/month" after that is a second segment and not
    // captured — the value match still anchors and lands "$25 / user" in tiers.
    const tiers = extractPriceTiers('$25 / user / month for teams');
    // At minimum the currency-anchored portion must land:
    expect(tiers.some((t) => t.startsWith('$25'))).toBe(true);
  });

  it('extracts the literal "Free tier" sentinel alongside a paid price', () => {
    const tiers = extractPriceTiers('Free tier available. Premium at $9.99/month.');
    expect(tiers).toContain('Free tier');
    expect(tiers).toContain('$9.99/month');
  });

  it('extracts "Free forever" via Free + paid co-occurrence rule', () => {
    // Mixed input from PLAN T-V03: free-forever + a paid tier => both appear.
    const tiers = extractPriceTiers('Free forever, then $10/mo');
    // Either the "Free tier" sentinel branch OR the bare "Free" co-occurrence
    // branch must populate a Free* entry; paid tier must always appear.
    expect(tiers.some((t) => /free/i.test(t))).toBe(true);
    expect(tiers).toContain('$10/mo');
  });

  it('rejects HTML entity / CSS class digit noise (no false positives) — M1 core', () => {
    // PLAN T-V03 fixture: HTML noise input must produce tiers === [].
    const tiers = extractPriceTiers('copyright &#8217; 2024 class=col-474');
    expect(tiers).toEqual([]);
  });

  it('rejects an HTML span tag with non-price content', () => {
    const tiers = extractPriceTiers('<span class="price-tier-1">No actual price here</span>');
    expect(tiers).toEqual([]);
  });

  it('rejects bare version / year numbers without currency anchor', () => {
    const tiers = extractPriceTiers('version 8217 release in 2024');
    expect(tiers).toEqual([]);
  });

  it('mixed currency + noise: extracts only the currency-anchored values', () => {
    // Combination guard: $39/mo and $399/yr must land; 2024 and 474 must NOT.
    const tiers = extractPriceTiers(
      'class=col-474 buy now for $39/mo or $399/yr lifetime — © 2024'
    );
    expect(tiers).toContain('$39/mo');
    expect(tiers).toContain('$399/yr');
    expect(tiers).not.toContain('474');
    expect(tiers).not.toContain('2024');
  });
});
