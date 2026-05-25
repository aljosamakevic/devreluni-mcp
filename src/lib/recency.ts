// Shared recency classifier for snippet / title text.
//
// Used by check_big_tech_encroachment and find_why_now_signals to bucket
// search results into the last 24mo window. The heuristic is intentionally
// dumb (year-string presence) — the goal is "did this page mention a recent
// year somewhere visible to SERP?", not full date parsing.
//
// Pure: no I/O, no clock reads beyond module initialisation. `CURRENT_YEAR`
// snapshots once per process start (matching the previous inline behaviour).

export const CURRENT_YEAR = new Date().getFullYear();
export const RECENT_YEARS: readonly number[] = [
  CURRENT_YEAR,
  CURRENT_YEAR - 1,
  CURRENT_YEAR - 2,
];

export type RecencySignal = 'last_24mo' | 'older' | 'unknown';

/**
 * Classify `text` by the most-recent 4-digit year it mentions.
 *
 *  - Any of the last 3 years (inclusive) anywhere in the text → 'last_24mo'.
 *  - Any other 4-digit 19xx/20xx year (and no recent year) → 'older'.
 *  - No 4-digit year at all → 'unknown'.
 *
 * This matches the inline implementation that previously lived in
 * check-big-tech-encroachment.ts and find-why-now-signals.ts.
 */
export function detectRecency(text: string): RecencySignal {
  for (const y of RECENT_YEARS) {
    if (text.includes(String(y))) return 'last_24mo';
  }
  const oldYear = text.match(/\b(19|20)\d{2}\b/);
  if (oldYear && !RECENT_YEARS.includes(parseInt(oldYear[0], 10))) return 'older';
  return 'unknown';
}
