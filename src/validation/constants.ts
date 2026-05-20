/**
 * Validator constants used across the structural validator (T07), the
 * verdict validator (T08), the renderer (T09a), and the fixtures.
 *
 * Kept in their own module to avoid an import cycle: the fixtures need the
 * canonical strings, and the structural validator's self-check block needs
 * the fixtures — pulling the strings out of the validator file breaks that
 * cycle.
 */

/**
 * Canonical Spiky POV blank template (spec §5 Section 6 — exact wording).
 *
 * MUST match byte-for-byte. The renderer (T09a) emits this constant verbatim
 * regardless of LLM input — defense-in-depth. The structural validator (T07)
 * also enforces equality.
 *
 * Spec §1 mechanism 5 + Appendix B(4) + §11 anti-pattern 4.
 */
export const SPIKY_POV_BLANK_TEMPLATE: string =
  '> ⚠️ The verdict above is a model-generated recommendation. The decision is yours.\n\n' +
  'My take: [user fills in]\n' +
  'What I disagree with in the report: [user fills in]\n' +
  'What I\'m going to do: [user fills in]\n';

/**
 * Canonical "no counter-evidence found" sentinel. Spec §6.1 Step 1e + §5
 * Section 3. The structural validator accepts either ≥1 substantive
 * counter-evidence entry OR a single entry whose `text` equals this string
 * exactly (and whose `source` is `null`).
 */
export const CONTRADICTING_EVIDENCE_NONE_SENTINEL: string =
  'No contradicting evidence surfaced — treat as a gap, not confirmation.';
