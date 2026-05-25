// Platform keyword map for assess_platform_dependency (Gate 3 P1).
//
// Static heuristic table: maps lowercase trigger phrases to canonical
// platform-dependency entries. Used to extract likely platform deps from
// a free-text idea_description when the user hasn't explicitly listed them.
//
// Per spec §7 (assess_platform_dependency entry) and PLAN T16 acceptance:
//   - Must include Apple Intelligence, Screen Time API, Focus Modes, and
//     Digital Wellbeing terms (focus-app encroachment territory).
//   - Trigger phrases are matched as substrings (case-insensitive) against
//     `idea_description + ' ' + category`. Keep them specific enough that
//     "ios" doesn't accidentally fire on "obvious".
//
// Each entry carries:
//   - `platform`     — canonical name shown on the wire (e.g. "App Store").
//   - `triggers[]`   — lowercase substrings that activate this entry.
//   - `tos_domain`   — official ToS / dev-docs domain for site-filtered Serper
//                      searches (tier S, bias 'conflicted' per spec §4 rule 6).
//   - `risk_notes`   — short framing-agnostic note on why this platform is
//                      load-bearing. Surfaced verbatim in tool output.
//   - `restrictive`  — heuristic flag: true = platform has documented history
//                      of restrictive enforcement (App Store, Twitter API, IG,
//                      Screen Time framework, etc.). Drives the risk score.
//
// Heuristic only — never fabricates. If no triggers match, the tool returns
// an empty platforms_detected[] and a confidence_note explaining the gap.

export interface PlatformEntry {
  platform: string;
  triggers: string[];
  tos_domain: string;
  risk_notes: string;
  restrictive: boolean;
}

export const PLATFORM_KEYWORDS: PlatformEntry[] = [
  // ─── Apple ecosystem (highest-risk for B2C focus/productivity apps) ────
  {
    platform: 'App Store',
    triggers: ['app store', 'ios app', 'iphone app', 'ipad app', 'macos app'],
    tos_domain: 'developer.apple.com',
    risk_notes:
      'Apple App Store review policies + 30% take rate. History of rejecting apps that duplicate "system features" (Spotlight killed launchers, Notes killed many note apps).',
    restrictive: true,
  },
  {
    platform: 'iOS / Apple platform APIs',
    triggers: ['ios', 'iphone', 'ipados', 'apple watch', 'watchos', 'visionos'],
    tos_domain: 'developer.apple.com',
    risk_notes:
      'Apple platform APIs subject to deprecation at WWDC. SDK access controlled by entitlements; entitlement requests can be denied.',
    restrictive: true,
  },
  {
    platform: 'Apple Intelligence',
    triggers: [
      'apple intelligence',
      'apple ai',
      'on-device llm apple',
      'siri intelligence',
    ],
    tos_domain: 'developer.apple.com',
    risk_notes:
      'Apple Intelligence ships native AI features (writing, summarization, image gen) that overlap with many third-party AI apps — Apple-favored placement on first-party hardware.',
    restrictive: true,
  },
  {
    platform: 'Apple Screen Time API',
    triggers: [
      'screen time',
      'screen time api',
      'screentime',
      'screen monitoring',
      'screen-time',
    ],
    tos_domain: 'developer.apple.com',
    risk_notes:
      'Screen Time framework (FamilyControls / DeviceActivity / ManagedSettings) is restricted to a narrow approved use case; Apple has rejected and revoked apps that "misuse" it. High-risk dependency for focus / parental-control products.',
    restrictive: true,
  },
  {
    platform: 'Apple Focus Modes',
    triggers: [
      'focus mode',
      'focus modes',
      'do not disturb',
      'focus filter',
    ],
    tos_domain: 'developer.apple.com',
    risk_notes:
      'Focus Modes and FocusFilter API are first-party concentration features. Apple bundles increasing capability here each WWDC — direct encroachment risk for focus apps.',
    restrictive: true,
  },

  // ─── Google / Android ecosystem ────────────────────────────────────────
  {
    platform: 'Google Play Store',
    triggers: ['play store', 'android app', 'google play'],
    tos_domain: 'play.google.com',
    risk_notes:
      'Play Store policies enforced via automated + manual review; periodic policy changes (e.g. accessibility-API restrictions) have killed entire app categories.',
    restrictive: true,
  },
  {
    platform: 'Android platform APIs',
    triggers: ['android', 'wear os'],
    tos_domain: 'developer.android.com',
    risk_notes:
      'Android API access tightens version-over-version (background restrictions, scoped storage, foreground service rules).',
    restrictive: true,
  },
  {
    platform: 'Android Digital Wellbeing',
    triggers: [
      'digital wellbeing',
      'digital well-being',
      'usage stats android',
      'usage access',
    ],
    tos_domain: 'developer.android.com',
    risk_notes:
      'Digital Wellbeing is Google\'s first-party focus/usage feature. Third-party access to UsageStats requires PACKAGE_USAGE_STATS permission, which Play Store flags as sensitive.',
    restrictive: true,
  },
  {
    platform: 'Chrome Web Store',
    triggers: [
      'chrome extension',
      'browser extension',
      'chromium extension',
      'edge extension',
      'web extension',
    ],
    tos_domain: 'developer.chrome.com',
    risk_notes:
      'Manifest V3 migration killed many ad-blocker / privacy extensions. Google can de-list extensions at any time; appeals are opaque.',
    restrictive: true,
  },

  // ─── Social platform APIs (notoriously restrictive) ───────────────────
  {
    platform: 'Twitter/X API',
    triggers: ['twitter', 'tweet', 'x.com api', 'x api', 'tweets'],
    tos_domain: 'developer.x.com',
    risk_notes:
      'Twitter/X has repeatedly killed third-party clients and raised API pricing 100x+ (Jan 2023). Single-platform dependency on X API = existential.',
    restrictive: true,
  },
  {
    platform: 'Instagram Graph API',
    triggers: ['instagram', 'instagram api', 'ig api'],
    tos_domain: 'developers.facebook.com',
    risk_notes:
      'Meta has deprecated and re-scoped Instagram APIs multiple times; consumer-facing scraping uses are aggressively shut down.',
    restrictive: true,
  },
  {
    platform: 'TikTok API',
    triggers: ['tiktok', 'tiktok api'],
    tos_domain: 'developers.tiktok.com',
    risk_notes:
      'TikTok developer access is narrow and approval-gated; geopolitical risk on top of platform-policy risk.',
    restrictive: true,
  },
  {
    platform: 'LinkedIn API',
    triggers: ['linkedin', 'linkedin api'],
    tos_domain: 'developer.linkedin.com',
    risk_notes:
      'LinkedIn API access is partner-only for most endpoints; scraping is litigated against (hiQ Labs case).',
    restrictive: true,
  },

  // ─── E-commerce / SaaS platforms ──────────────────────────────────────
  {
    platform: 'Shopify App Store',
    triggers: ['shopify', 'shopify app', 'shopify store'],
    tos_domain: 'shopify.dev',
    risk_notes:
      'Shopify owns the merchant relationship and routinely ships native versions of popular app features. Revenue-share + review-gated distribution.',
    restrictive: true,
  },
  {
    platform: 'Slack App Directory',
    triggers: ['slack app', 'slack bot', 'slack integration'],
    tos_domain: 'api.slack.com',
    risk_notes:
      'Slack API rate limits and scope deprecations are common; Salesforce ownership reshapes priorities periodically.',
    restrictive: false,
  },
  {
    platform: 'Stripe API',
    triggers: ['stripe', 'stripe api', 'stripe connect'],
    tos_domain: 'stripe.com',
    risk_notes:
      'Stripe can freeze accounts for ToS interpretations (high-risk verticals: adult, crypto, firearms). Less risky than App Stores but still a dependency.',
    restrictive: false,
  },

  // ─── LLM provider dependencies (dev-tools category in particular) ─────
  {
    platform: 'OpenAI API',
    triggers: ['openai', 'gpt-4', 'gpt-5', 'chatgpt api', 'gpt api'],
    tos_domain: 'platform.openai.com',
    risk_notes:
      'OpenAI ToS has shifted multiple times re: training, output usage, and competing-product clauses. Pricing and model availability change without notice.',
    restrictive: true,
  },
  {
    platform: 'Anthropic API',
    triggers: ['anthropic', 'claude api'],
    tos_domain: 'docs.anthropic.com',
    risk_notes:
      'Anthropic Usage Policies + AUP enforcement. Capability and pricing tiers evolve quickly.',
    restrictive: false,
  },
];

// ─── Longest-trigger-first match helper (D-T16-1) ──────────────────────────
//
// The PLATFORM_KEYWORDS array above is ordered by ECOSYSTEM (Apple → Google →
// Social → SaaS → LLM) for human reviewability — that order is load-bearing
// for audits and MUST NOT be mutated. But for substring matching we want the
// MOST SPECIFIC trigger to win: e.g. "Android Digital Wellbeing" must match
// its dedicated entry, not the broader "Android platform APIs" (which has the
// trigger "android" — a substring of the haystack).
//
// Solution: build a sorted VIEW at module-init time (separate array, original
// untouched), sorted by descending max(trigger.length). At match time, iterate
// the sorted view and collect every entry whose trigger appears in the
// lowercased haystack. Tie-break on equal max-trigger-length: original
// declaration order (stable sort).

interface SortedView {
  entry: PlatformEntry;
  maxTriggerLen: number;
  declOrder: number;
}

const PLATFORM_KEYWORDS_BY_SPECIFICITY: SortedView[] = PLATFORM_KEYWORDS
  .map((entry, declOrder) => ({
    entry,
    maxTriggerLen: entry.triggers.reduce((m, t) => Math.max(m, t.length), 0),
    declOrder,
  }))
  .slice()
  .sort((a, b) => {
    if (b.maxTriggerLen !== a.maxTriggerLen) return b.maxTriggerLen - a.maxTriggerLen;
    return a.declOrder - b.declOrder;
  });

/**
 * Return every PLATFORM_KEYWORDS entry whose trigger appears in `haystack`,
 * ordered by descending max-trigger-length (most specific first). Tie-break:
 * original declaration order. Case-insensitive.
 *
 * Fixes D-T16-1: ensures "Android Digital Wellbeing" beats "android" when the
 * haystack mentions both.
 */
export function getMatchingPlatforms(haystack: string): PlatformEntry[] {
  const lower = haystack.toLowerCase();
  const hits: PlatformEntry[] = [];
  const seen = new Set<string>();
  for (const { entry } of PLATFORM_KEYWORDS_BY_SPECIFICITY) {
    if (seen.has(entry.platform)) continue;
    if (entry.triggers.some((t) => lower.includes(t))) {
      hits.push(entry);
      seen.add(entry.platform);
    }
  }
  return hits;
}
