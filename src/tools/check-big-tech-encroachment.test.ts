// T-V05 — Regression guard for CONCERNS.md M4: extractAcquisitionTarget MUST
// require an explicit deal anchor (price tag, "in a $X deal", literal "deal",
// or "$<digits>") to follow the target name. The prior regex over-matched on
// titles like "Pixelmator hints at" and fell back to a 60-char slice of the
// headline, fabricating phantom acquisitions like "This Week in Apps".
//
// This test file pins BOTH branches:
//   - Positive: 5 real headlines that must extract the correct target.
//   - Negative trade-off lock-ins: 5 headlines the OLD fuzzy regex would have
//     matched (or sliced into a phantom acquisition) but the new strict regex
//     correctly REJECTS. If a future change reverts to looser matching, these
//     tests fail and the reviewer must explicitly justify re-opening M4.
//
// PLAN warning 4 lock-in: do NOT "fix" the negative cases by loosening the
// regex without re-reading CONCERNS.md M4 first. Dropping a real acquisition
// is preferred to fabricating one. (spec §11 anti-pattern 2.)

import { describe, expect, it } from 'vitest';
import { extractAcquisitionTarget } from './check-big-tech-encroachment.js';

describe('extractAcquisitionTarget — positives (M4 regression guard)', () => {
  it('extracts "Pixelmator" from a price-anchored Apple acquisition', () => {
    expect(extractAcquisitionTarget('Apple acquires Pixelmator for $200M')).toBe('Pixelmator');
  });

  it('extracts "Looker" from a "in a $X deal" Google headline', () => {
    expect(extractAcquisitionTarget('Google acquired Looker in a $2.6B deal')).toBe('Looker');
  });

  it('extracts a multi-word target "Activision Blizzard" from a Microsoft headline', () => {
    expect(
      extractAcquisitionTarget('Microsoft acquires Activision Blizzard in a $69B deal'),
    ).toBe('Activision Blizzard');
  });

  it('extracts a hyphenated target "CTRL-labs" from a Meta headline', () => {
    expect(extractAcquisitionTarget('Meta acquired CTRL-labs for $1B')).toBe('CTRL-labs');
  });

  it('extracts "MGM" from an Amazon headline (uppercase-anchored target)', () => {
    // Regex requires the target name to begin with an uppercase letter — lowercase
    // brand starts like "iRobot" are a known limitation; we deliberately use
    // an uppercase-anchored case here. (See M4 trade-off in CONCERNS.md.)
    expect(extractAcquisitionTarget('Amazon acquires MGM in a $8.45B deal')).toBe('MGM');
  });
});

describe('extractAcquisitionTarget — locked trade-off negatives (M4 regression guard)', () => {
  // NOTE: These cases lock in the M4 trade-off. If any of these later need to
  // match, the M4 regex needs to be re-examined — re-read CONCERNS.md M4 first
  // and confirm the spec §11 anti-pattern 2 ("no made-up data > more signal")
  // is no longer being violated by the looser variant. Do NOT loosen silently.

  it('rejects "Apple snaps up small AI startup" (no acquire verb — old fuzzy fallback)', () => {
    // The OLD fuzzy logic might have flagged "snaps up" as acquisition signal
    // and sliced the headline. New regex requires the "acquire/acquired" verb.
    expect(extractAcquisitionTarget('Apple snaps up small AI startup')).toBeNull();
  });

  it('rejects "Google reportedly in talks to buy WordSmith" (no acquire verb)', () => {
    // "buy" is not "acquires/acquired" — drop rather than fabricate.
    expect(
      extractAcquisitionTarget('Google reportedly in talks to buy WordSmith'),
    ).toBeNull();
  });

  it('rejects "Microsoft eyes acquisition of analytics firm" (noun form, no completed verb)', () => {
    // "eyes acquisition" is rumour, not a completed deal.
    expect(
      extractAcquisitionTarget('Microsoft eyes acquisition of analytics firm'),
    ).toBeNull();
  });

  it('rejects truncated "Why did Meta acquire [headline truncated...]" (no end anchor)', () => {
    // Truncated / malformed headlines must NOT produce a headline-slice fallback.
    expect(
      extractAcquisitionTarget('Why did Meta acquire [headline truncated...]'),
    ).toBeNull();
  });

  it('rejects "Apple\'s strategy after acquiring Pixelmator hints at..." (no deal end-anchor)', () => {
    // PLAN T-V05 marquee fixture. The OLD regex matched "acquiring Pixelmator"
    // followed by "hints at" and emitted Pixelmator as a phantom NEW deal.
    // The new regex requires a price or "deal" anchor; "hints at" doesn't qualify.
    expect(
      extractAcquisitionTarget(
        "Apple's AI strategy after acquiring Pixelmator hints at deeper AI ambitions",
      ),
    ).toBeNull();
  });

  it('rejects "Why Google acquired Looker last year — analysts weigh in" (no terminal anchor)', () => {
    expect(
      extractAcquisitionTarget(
        'Why Google acquired Looker last year — analysts weigh in',
      ),
    ).toBeNull();
  });

  it('rejects "Apple acquires AI startup — sources" (no $X or deal end-anchor)', () => {
    expect(
      extractAcquisitionTarget('Apple acquires AI startup — sources'),
    ).toBeNull();
  });
});
