// Category → platform-feature synonym map.
//
// Per CONCERNS.md M5: the literal `${queryBase} site:developer.apple.com`
// hyperscaler searches in check_big_tech_encroachment miss feature names
// that don't share keywords with the product category. A "focus app" must
// surface "Apple Intelligence", "Screen Time", and "Focus Modes" — these
// are the features that would obsolete the idea, and they don't contain
// the word "focus" or "deep work". This map provides per-hyperscaler
// platform-feature synonyms keyed off the category, fed into the search
// fan-out so first-party platform docs actually appear in `sources[]`.
//
// Map shape (per PLAN T06):
//   Map<categoryKeyword, { apple: string[]; google: string[]; microsoft: string[] }>
//
// Lookup is case-insensitive; unmapped categories return empty arrays and
// the base query is used unchanged (no synonyms = no fan-out).

export interface PlatformFeatureMap {
  apple: string[];
  google: string[];
  microsoft: string[];
}

export const CATEGORY_FEATURE_SYNONYMS: Record<string, PlatformFeatureMap> = {
  'focus app': {
    apple: ['Apple Intelligence', 'Screen Time', 'Screen Time API', 'Focus Modes', 'Do Not Disturb'],
    google: ['Digital Wellbeing', 'Focus Mode Android', 'Bedtime Mode'],
    microsoft: ['Focus Sessions Windows 11', 'Viva Insights focus', 'Copilot Focus'],
  },
  'deep work': {
    apple: ['Apple Intelligence', 'Screen Time', 'Focus Modes'],
    google: ['Digital Wellbeing', 'Focus Mode Android'],
    microsoft: ['Focus Sessions Windows 11', 'Viva Insights focus'],
  },
  'writing assistant': {
    apple: ['Apple Intelligence Writing Tools', 'Smart Reply'],
    google: ['Help me write Gmail', 'Smart Compose', 'Gemini in Workspace'],
    microsoft: ['Copilot in Word', 'Editor Microsoft', 'Designer'],
  },
  'ai writing': {
    apple: ['Apple Intelligence Writing Tools', 'Smart Reply'],
    google: ['Help me write Gmail', 'Smart Compose', 'Gemini in Workspace'],
    microsoft: ['Copilot in Word', 'Editor Microsoft'],
  },
  'calendar ai': {
    apple: ['Siri scheduling', 'Calendar Suggestions iOS', 'Apple Intelligence'],
    google: ['Gemini in Calendar', 'Reclaim Google Calendar AI'],
    microsoft: ['Copilot in Outlook', 'Microsoft Scheduler'],
  },
  'scheduling assistant': {
    apple: ['Siri scheduling', 'Calendar Suggestions iOS'],
    google: ['Gemini in Calendar', 'Reclaim Google Calendar AI'],
    microsoft: ['Copilot in Outlook', 'Microsoft Scheduler'],
  },
  'note taking': {
    apple: ['Apple Notes', 'Genmoji Notes', 'Apple Intelligence'],
    google: ['Google Keep AI', 'NotebookLM'],
    microsoft: ['OneNote Copilot', 'Loop Microsoft'],
  },
  'habit tracker': {
    apple: ['Apple Health', 'Screen Time', 'Activity Rings'],
    google: ['Google Fit', 'Digital Wellbeing'],
    microsoft: ['Viva Insights', 'Microsoft To Do'],
  },
};

// Hard cap per PLAN T06: never fire more than 3 extra feature queries
// per hyperscaler per phase, to bound Serper tool-call budget.
export const MAX_FEATURES_PER_HYPERSCALER = 3;

/**
 * Look up the platform-feature synonyms for a given category and hyperscaler.
 * Case-insensitive; returns [] if the category is unmapped (caller falls back
 * to the base query alone, no fan-out). Result is capped at
 * `MAX_FEATURES_PER_HYPERSCALER` entries to bound query budget.
 */
export function getCategoryFeatures(
  category: string,
  hyperscaler: 'apple' | 'google' | 'microsoft',
): string[] {
  const key = category.toLowerCase().trim();
  const entry = CATEGORY_FEATURE_SYNONYMS[key];
  if (!entry) return [];
  return entry[hyperscaler].slice(0, MAX_FEATURES_PER_HYPERSCALER);
}

/**
 * Convenience helper consumed at the top of check_big_tech_encroachment's
 * handler. Also consults `category_keywords` so callers passing
 * `{ category: 'productivity', category_keywords: ['deep work'] }` still
 * fan out via the "deep work" entry. Returns the union (deduped) of all
 * matching entries' per-hyperscaler feature lists, each capped at
 * MAX_FEATURES_PER_HYPERSCALER.
 */
export function expandHyperscalerQueries(
  category: string,
  keywords: string[] = [],
): PlatformFeatureMap {
  const candidates = [category, ...keywords];
  const acc: PlatformFeatureMap = { apple: [], google: [], microsoft: [] };
  for (const cand of candidates) {
    const key = cand.toLowerCase().trim();
    const entry = CATEGORY_FEATURE_SYNONYMS[key];
    if (!entry) continue;
    for (const hs of ['apple', 'google', 'microsoft'] as const) {
      for (const feat of entry[hs]) {
        if (!acc[hs].includes(feat)) acc[hs].push(feat);
      }
    }
  }
  return {
    apple: acc.apple.slice(0, MAX_FEATURES_PER_HYPERSCALER),
    google: acc.google.slice(0, MAX_FEATURES_PER_HYPERSCALER),
    microsoft: acc.microsoft.slice(0, MAX_FEATURES_PER_HYPERSCALER),
  };
}
