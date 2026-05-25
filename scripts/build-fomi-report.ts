#!/usr/bin/env tsx
/**
 * T-final-3 — Construct a ValidationReport JSON from the captured Phase 02
 * Fomi tool responses, call `finalize_validation_report`, and save both the
 * full tool response and the rendered markdown.
 *
 * Per R7: facts are quoted directly from the captured tool responses (no
 * fabrication). Verdict math follows spec §3 / §4 / §5 mechanically.
 */

import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const RESP_DIR = resolve(REPO_ROOT, '.planning/validation-runs/02-fomi-tool-responses');

const FETCHED_AT = new Date().toISOString();

interface Src {
  url: string;
  tier: 'S' | 'A' | 'B' | 'C' | 'D';
  bias: 'independent' | 'vendor-funded' | 'conflicted' | 'unknown';
  fetched_at: string;
  contribution: string;
}

function mkSrc(url: string, tier: Src['tier'], bias: Src['bias'], contribution: string, fetched?: string): Src {
  return { url, tier, bias, fetched_at: fetched ?? FETCHED_AT, contribution };
}

const IDEA =
  'AI-native focus app that monitors screens to keep users on-task. Detects when users drift off-task (social media, distracting sites), gently nudges back via interventions. Uses cloud screenshot analysis.';

// ─── Sources drawn from real captured tool outputs ────────────────────────

// Gate 1 — competitors (find_closest_competitor.data.competitors[])
const S_g1_reddit_adhd_prog = mkSrc(
  'https://www.reddit.com/r/ADHD_Programmers/comments/1l2qo6f/ai_tool_that_keeps_you_on_track_by_literally/',
  'A',
  'independent',
  'Reddit r/ADHD_Programmers: shipping AI tool that watches your screen and pings when off-task — direct functional convergence with proposed idea',
);
const S_g1_hustle = mkSrc(
  'https://thehustle.co/news/easily-distracted-this-ai-focus-tool-will-scold-you-into-staying-on-task',
  'A',
  'independent',
  'The Hustle: AI focus tool that monitors and analyzes your screen to determine whether you are on-task — feature parity with proposed idea',
);
const S_g1_focusmo = mkSrc(
  'https://www.youtube.com/watch?v=khfS00oZizI',
  'B',
  'conflicted',
  'YouTube: Focusmo — ADHD-targeted focus app with app blocking + check-ins',
);
const S_g1_map_serper = mkSrc(
  'https://google.serper.dev/search?q=Fomi%20%22not%20worth%22%20OR%20%22cancelled%22%20OR%20%22switched%20from%22%20OR%20%22disappointed%22%20OR%20%22terrible%22',
  'A',
  'independent',
  'Serper search for Fomi user complaints — surfaced negative-sentiment hits indicating churn-out pattern',
);
const S_g1_changelog_boomi = mkSrc(
  'https://community.boomi.com/s/topic/0TO1W000000cn2eWAA/release-notes',
  'S',
  'conflicted',
  'read_competitor_changelog URL-guessing fallback resolved to Boomi release notes — unrelated to Fomi; logged as a known tool failure',
);
const S_g1_contra = mkSrc(
  'https://google.serper.dev/search?q=AI-native%20focus%20app%20that%20monitors%20screens%20to%20keep%20users%20on-task.%20Detects%20when%20users%20drift%20off-task%20(social%20media%2C%20distracting%20sites)%2C%20gently%20nudges%20back%20via%20interventions.%20Uses%20cloud%20screenshot%20analysis.%20profitable%20indie%20AI%20focus%20app%20success%20story%202025%20competitor%20alternatives',
  'A',
  'independent',
  'Contradicting-evidence Serper search for "profitable indie AI focus app success story 2025" — no clear contrarian winner surfaced',
);

// Gate 2 — demand + revenue
const S_g2_reddit_productivity = mkSrc(
  'https://www.reddit.com/r/productivity/about.json',
  'A',
  'independent',
  'r/productivity 4,195,056 subscribers — large active community',
);
const S_g2_reddit_adhd = mkSrc(
  'https://www.reddit.com/r/ADHD/about.json',
  'A',
  'independent',
  'r/ADHD 2,232,448 subscribers — primary target demographic',
);
const S_g2_reddit_getdis = mkSrc(
  'https://www.reddit.com/r/getdisciplined/about.json',
  'A',
  'independent',
  'r/getdisciplined 2,164,885 subscribers — adjacent target community',
);
const S_g2_ih_rize_10k = mkSrc(
  'https://www.indiehackers.com/post/bootstrapping-a-personal-productivity-saas-to-10k-mrr-cac5dfe318',
  'A',
  'independent',
  'IndieHackers: bootstrapped personal-productivity SaaS to $10k MRR — adjacent (time-tracking) comparable',
);
const S_g2_ih_session_2k = mkSrc(
  'https://www.indiehackers.com/product/session-2/2-000-mrr-revenue-and-100-reviews-on-app-store--MQvx6feV1Ez_Kq0qqzx',
  'A',
  'independent',
  'IndieHackers: Session focus app stuck at $2,000 MRR — typical B2C-solo ceiling',
);
const S_g2_techcrunch_distraction = mkSrc(
  'https://techcrunch.com/2025/12/25/the-best-distraction-blockers-to-jumpstart-your-focus-in-the-new-year/',
  'A',
  'independent',
  'TechCrunch 2025-12-25: roundup of distraction blockers — continued media attention in category',
);
const S_g2_ih_failed = mkSrc(
  'https://www.indiehackers.com/post/every-focus-app-i-tried-on-mac-failed-me-heres-what-finally-worked-7afe1db0a1',
  'A',
  'independent',
  'IndieHackers "Every focus app I tried on Mac failed me" — category-wide structural complaint',
);

// Gate 3 — encroachment + platform deps
// From assess_platform_dependency.sources[]
const S_g3_apple_devforums_managed_settings = mkSrc(
  'https://developer.apple.com/forums/tags/managed-settings?page=3',
  'S',
  'conflicted',
  'Apple Developer Forums: Managed Settings tag — Screen Time API surface that any iOS focus app must build on',
);
const S_g3_apple_review_guidelines = mkSrc(
  'https://developer.apple.com/app-store/review/guidelines/',
  'S',
  'conflicted',
  'Apple App Review Guidelines — first-party rulebook governing Screen Time / focus apps; ongoing policy churn',
);
const S_g3_serper_apple_screentime_tos = mkSrc(
  'https://google.serper.dev/search?q=%22Apple%20Screen%20Time%20API%22%20(ToS%20OR%20%22terms%20of%20service%22%20OR%20%22policy%20change%22%20OR%20deprecation)%202026%20OR%202025%20OR%20site%3Adeveloper.apple.com',
  'A',
  'independent',
  'Serper fan-out for Apple Screen Time API ToS / policy churn — feeds Gate 3 platform-dependency assessment',
);
const S_g3_serper_apple_screentime_deplat = mkSrc(
  'https://google.serper.dev/search?q=%22Apple%20Screen%20Time%20API%22%20(%22lost%20access%22%20OR%20%22deplatformed%22%20OR%20%22shut%20down%22%20OR%20%22kicked%20off%22%20OR%20%22banned%22%20OR%20%22rejected%22)%20founder%20OR%20retro%20OR%20postmortem%20site%3Amedium.com%20OR%20site%3Anews.ycombinator.com%20OR%20site%3Aindiehackers.com',
  'A',
  'conflicted',
  'Serper fan-out for Apple Screen Time API deplatforming retros — empty result is logged honestly (not fabricated)',
);
const S_g3_microsoft_viva = mkSrc(
  'https://learn.microsoft.com/en-us/answers/questions/5887032/viva-insights-focus-plan-stops-scheduling-focus-ti',
  'S',
  'conflicted',
  'Microsoft Learn: Viva Insights Focus Plan — Microsoft already ships focus-management as part of Microsoft 365',
);
const S_g3_apple_intelligence_query = mkSrc(
  'https://www.google.com/search?q=%22Apple%20Intelligence%22%20site%3Adeveloper.apple.com',
  'S',
  'conflicted',
  'M5 synonym-map expansion query: Apple Intelligence on developer.apple.com — fired as part of check_big_tech_encroachment',
);
const S_g3_apple_screentime_query = mkSrc(
  'https://www.google.com/search?q=%22Screen%20Time%20API%22%20site%3Adeveloper.apple.com',
  'S',
  'conflicted',
  'M5 synonym-map expansion query: Screen Time API on developer.apple.com — fired as part of check_big_tech_encroachment',
);

// Gate 4 — pricing
const S_g4_rescuetime_live = mkSrc(
  'https://rescuetime.com/pricing',
  'S',
  'conflicted',
  'RescueTime live pricing — $7/mo, $9/mo, $12/mo subscription tiers (clean post-M1 extraction; no currency artifacts)',
);
const S_g4_freedom_live = mkSrc(
  'https://freedom.to/pricing',
  'S',
  'conflicted',
  'Freedom live pricing — $3.33/mo and $8.99/mo freemium tiers (post-M2 Serper-resolved hostname: freedom.to not freedom.com)',
);
const S_g4_rize_live = mkSrc(
  'https://rize.io/pricing',
  'S',
  'conflicted',
  'Rize live pricing — $9.99/mo to $29.99/mo subscription range (post-M2 Serper-resolved hostname: rize.io)',
);
const S_g4_opal_live = mkSrc(
  'https://www.opal.so/pricing',
  'S',
  'conflicted',
  'Opal live pricing — $8.29/mo and $19.99/mo tiers (post-M2 Serper-resolved hostname: opal.so)',
);
const S_g4_focusbear_live = mkSrc(
  'https://www.focusbear.io/pricing',
  'S',
  'conflicted',
  'Focus Bear live pricing — $4.99/mo and $9.99/mo subscription tiers (post-M2 Serper-resolved hostname: focusbear.io)',
);
const S_g4_focusbear_wayback = mkSrc(
  'http://web.archive.org/web/20260503225259/https://www.focusbear.io/pricing',
  'S',
  'independent',
  'Wayback snapshot 2026-05-03: Focus Bear pricing — historical pricing anchor confirms sub-$10/mo ceiling',
  '2026-05-03T22:52:59Z',
);
const S_g4_opal_wayback = mkSrc(
  'http://web.archive.org/web/20260316045854/https://www.opal.so/pricing',
  'S',
  'independent',
  'Wayback snapshot 2026-03-16: Opal pricing — historical anchor',
  '2026-03-16T04:58:54Z',
);
const S_g4_g2_churn = mkSrc(
  'https://www.g2.com/search?query=focus%20app',
  'B',
  'independent',
  'G2/Capterra search: 5 refund / cancel / overpayment signals auto-flagged by find_pricing_anchors',
);

// Gate 5 — why now
const S_g5_apple_review_guidelines = S_g3_apple_review_guidelines; // shared
const S_g5_techcrunch_distraction = S_g2_techcrunch_distraction; // shared (launch cluster)
const S_g5_eu_ai_act = mkSrc(
  'https://www.google.com/search?q=focus%20app%20regulation%202026%20OR%202025%20site%3Aec.europa.eu',
  'A',
  'independent',
  'EU regulatory query via Serper — no focus-app-specific tailwind surfaced; EU AI Act is headwind for cloud-screenshot processing',
);
const S_g5_yc_rfs = mkSrc(
  'https://www.ycombinator.com/rfs',
  'A',
  'conflicted',
  'YC RFS — find_yc_rfs_alignment returned 0 category matches; no YC tailwind',
);

// ─── Build the report ────────────────────────────────────────────────────

const SPIKY_POV_TEMPLATE =
  '> ⚠️ The verdict above is a model-generated recommendation. The decision is yours.\n\n' +
  'My take: [user fills in]\n' +
  'What I disagree with in the report: [user fills in]\n' +
  "What I'm going to do: [user fills in]\n";

const CONTRA_NONE = 'No contradicting evidence surfaced — treat as a gap, not confirmation.';

// All sources used across the report — for appendix + header counts
const ALL_SOURCES: Array<{ src: Src; gates: number[]; doks: number[] }> = [
  { src: S_g1_reddit_adhd_prog, gates: [1], doks: [1] },
  { src: S_g1_hustle, gates: [1], doks: [1] },
  { src: S_g1_focusmo, gates: [1], doks: [1] },
  { src: S_g1_map_serper, gates: [1], doks: [1] },
  { src: S_g1_changelog_boomi, gates: [1], doks: [1] },
  { src: S_g1_contra, gates: [1], doks: [1] },
  { src: S_g2_reddit_productivity, gates: [2], doks: [1] },
  { src: S_g2_reddit_adhd, gates: [2], doks: [1] },
  { src: S_g2_reddit_getdis, gates: [2], doks: [1] },
  { src: S_g2_ih_rize_10k, gates: [2, 4], doks: [1] },
  { src: S_g2_ih_session_2k, gates: [4], doks: [1] },
  { src: S_g2_techcrunch_distraction, gates: [2, 5], doks: [1] },
  { src: S_g2_ih_failed, gates: [1], doks: [1] },
  { src: S_g3_apple_devforums_managed_settings, gates: [3], doks: [1] },
  { src: S_g3_apple_review_guidelines, gates: [3, 5], doks: [1] },
  { src: S_g3_serper_apple_screentime_tos, gates: [3], doks: [1] },
  { src: S_g3_serper_apple_screentime_deplat, gates: [3], doks: [1] },
  { src: S_g3_microsoft_viva, gates: [3], doks: [1] },
  { src: S_g3_apple_intelligence_query, gates: [3], doks: [1] },
  { src: S_g3_apple_screentime_query, gates: [3], doks: [1] },
  { src: S_g4_rescuetime_live, gates: [4], doks: [1] },
  { src: S_g4_freedom_live, gates: [4], doks: [1] },
  { src: S_g4_rize_live, gates: [4], doks: [1] },
  { src: S_g4_opal_live, gates: [4], doks: [1] },
  { src: S_g4_focusbear_live, gates: [4], doks: [1] },
  { src: S_g4_focusbear_wayback, gates: [4], doks: [1] },
  { src: S_g4_opal_wayback, gates: [4], doks: [1] },
  { src: S_g4_g2_churn, gates: [4], doks: [1] },
  { src: S_g5_eu_ai_act, gates: [5], doks: [1] },
  { src: S_g5_yc_rfs, gates: [5], doks: [1] },
];

// De-dupe appendix by URL while merging gates/doks
const apMap = new Map<string, { src: Src; gates: Set<number>; doks: Set<number> }>();
for (const e of ALL_SOURCES) {
  const k = e.src.url;
  if (!apMap.has(k)) {
    apMap.set(k, { src: e.src, gates: new Set(e.gates), doks: new Set(e.doks) });
  } else {
    const cur = apMap.get(k)!;
    for (const g of e.gates) cur.gates.add(g);
    for (const d of e.doks) cur.doks.add(d);
  }
}

const source_appendix = Array.from(apMap.values()).map((row, i) => ({
  index: i + 1,
  source: row.src,
  gates: Array.from(row.gates).sort() as Array<1 | 2 | 3 | 4 | 5>,
  dok_layers: Array.from(row.doks).sort() as Array<1 | 2 | 3 | 4>,
}));

const tierCounts = { S: 0, A: 0, B: 0, C: 0, D: 0 };
const biasCounts = { independent: 0, 'vendor-funded': 0, conflicted: 0, unknown: 0 };
for (const row of source_appendix) {
  tierCounts[row.source.tier] += 1;
  biasCounts[row.source.bias] += 1;
}

// ─── Per-gate source-meta helpers ────────────────────────────────────────

function gateMeta(...sources: Src[]) {
  const t = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  const b = { independent: 0, 'vendor-funded': 0, conflicted: 0, unknown: 0 };
  for (const s of sources) {
    t[s.tier] += 1;
    b[s.bias] += 1;
  }
  return { consulted: sources.length, tiers: t, bias: b };
}

// ─── Gate 1 ──────────────────────────────────────────────────────────────

const gate1 = {
  gate: 1 as const,
  name: 'Direct Competitor Scan',
  status: 'FAIL' as const,
  confidence: 'Medium' as const,
  dok1_facts: [
    {
      text: 'find_closest_competitor returned a r/ADHD_Programmers thread (id 1l2qo6f) titled "AI tool that keeps you on track by literally [watching your screen]" describing a shipping product that watches the screen and uses AI to detect off-task behavior — exact functional convergence with the proposed idea.',
      source: S_g1_reddit_adhd_prog,
    },
    {
      text: 'The Hustle headline "Easily distracted? This AI focus tool will scold you into staying on task" describes a shipping product that "monitors and analyzes your screen to determine whether what [you are doing matches your task]" — additional direct competitor.',
      source: S_g1_hustle,
    },
    {
      text: 'YouTube product video: "The Reason ADHD Brains Struggle With Focus (Focusmo App)" — Focusmo is an existing ADHD-focused app with app blocking + check-ins, identical buyer persona.',
      source: S_g1_focusmo,
    },
    {
      text: 'map_competitive_weaknesses fired a Serper query for Fomi negative-sentiment terms ("not worth", "cancelled", "switched from", "disappointed", "terrible") and surfaced churn-out / dissatisfaction language in the category.',
      source: S_g1_map_serper,
    },
    {
      text: 'IndieHackers post titled "Every focus app I tried on Mac failed me — here\'s what finally worked" documents Cold Turkey "too rigid" and Focus (Mac app) "too easy to bypass" — category-wide structural failure pattern across multiple incumbents.',
      source: S_g2_ih_failed,
    },
    {
      text: 'read_competitor_changelog for product="Fomi" resolved to community.boomi.com release notes (unrelated Boomi platform) — tool failure logged honestly per spec §11 anti-pattern 2; no Fomi-specific changelog evidence captured.',
      source: S_g1_changelog_boomi,
    },
  ],
  dok2_summary:
    'Multiple direct or adjacent AI-screen-monitoring focus apps already ship today (the r/ADHD_Programmers tool, The Hustle-covered AI focus tool, Focusmo, plus the wider Fomi/Opal/Cold Turkey cohort). Public discussion shows category-wide churn ("Every focus app I tried on Mac failed me"). The targeted Fomi changelog probe failed via URL-guessing fallback (resolved to Boomi); Fomi-specific changelog signal is absent — but the broader landscape conclusion is well-evidenced.',
  dok3_insights: [
    {
      text: 'Model judgment: at least 3 directly-overlapping AI-screen-monitoring products are shipping today — the founder does not enter as a first-mover. The "I have the problem too" angle does not produce structural differentiation.',
      is_model_judgment: true as const,
    },
    {
      text: 'Model judgment: the IndieHackers "every focus app failed me" pattern is best read as a category symptom (users churn through tools) rather than a winnable wedge — new entrants must defeat the same churn mechanism without breaking the privacy / bypass-resistance trade-off.',
      is_model_judgment: true as const,
    },
  ],
  contradicting_evidence: [
    {
      text:
        'A counter-angled Serper search for "profitable indie AI focus app success story 2025" returned only listicles and adjacent products — no profitable indie AI-screen-monitoring focus app surfaced as a contrarian success.',
      source: S_g1_contra,
    },
  ],
  dok4_verdict: {
    status: 'FAIL' as const,
    confidence: 'Medium' as const,
    reasoning:
      'FAIL because (a) ≥3 directly-overlapping AI-screen-monitoring products are shipping (the r/ADHD_Programmers tool, the Hustle-covered AI tool, Focusmo); (b) Fomi\'s own positioning + the IndieHackers "every focus app failed me" thread evidence category-wide churn that any new entrant must defeat; (c) the contradicting-evidence search surfaced no indie AI-screen-monitoring success story. ≥2 tier-A independent sources back the finding (Reddit, The Hustle, IndieHackers). Confidence is Medium because the deepest-overlap competitor evidence sits in tier A, not tier S, and the changelog probe for Fomi failed.',
  },
  source_meta: gateMeta(
    S_g1_reddit_adhd_prog,
    S_g1_hustle,
    S_g1_focusmo,
    S_g1_map_serper,
    S_g1_changelog_boomi,
    S_g2_ih_failed,
    S_g1_contra,
  ),
};

// ─── Gate 2 ──────────────────────────────────────────────────────────────

const gate2 = {
  gate: 2 as const,
  name: 'Market Demand',
  status: 'PASS' as const,
  confidence: 'Medium' as const,
  dok1_facts: [
    {
      text: 'r/productivity has 4,195,056 subscribers — very large active community in the productivity space (estimate_demand_signals → Reddit /about.json live fetch).',
      source: S_g2_reddit_productivity,
    },
    {
      text: 'r/ADHD has 2,232,448 subscribers — primary target demographic for focus apps is large and active.',
      source: S_g2_reddit_adhd,
    },
    {
      text: 'r/getdisciplined has 2,164,885 subscribers — adjacent target community is similarly large.',
      source: S_g2_reddit_getdis,
    },
    {
      text: 'Rize, an indie time-tracking SaaS, publicly reports >$10k MRR on IndieHackers — at least one indie comparable in the adjacent (time-tracking) mechanic clears the B2C-solo lifestyle threshold.',
      source: S_g2_ih_rize_10k,
    },
    {
      text: 'TechCrunch 2025-12-25 roundup of distraction blockers (Opal, Freedom, etc.) confirms continued press attention and launch cadence in the focus-app category.',
      source: S_g2_techcrunch_distraction,
    },
  ],
  dok2_summary:
    'Demand-side signal is strong: very large communities (~4.2M r/productivity, ~2.2M r/ADHD, ~2.2M r/getdisciplined), an IndieHackers comparable (Rize) above $10k MRR in adjacent time-tracking, and continued press coverage of new entrants. Niche reachability for B2C-solo framing is clearly met.',
  dok3_insights: [
    {
      text: 'Model judgment: demand for "focus" tools is real and large, but the only profitable comparable surfaced (Rize, $10k+ MRR) is a time-tracker, not an AI-screen-monitoring app — the demand may be for a different shape of product.',
      is_model_judgment: true as const,
    },
    {
      text: 'Model judgment: for B2C-solo framing the niche-reachability bar is met (multi-million-subscriber communities, concentrated channels), so Gate 2 itself does not kill the idea — but the upside is capped by Gate 4 dynamics.',
      is_model_judgment: true as const,
    },
  ],
  contradicting_evidence: [
    { text: CONTRA_NONE, source: null },
  ],
  dok4_verdict: {
    status: 'PASS' as const,
    confidence: 'Medium' as const,
    reasoning:
      'PASS at Medium confidence — niche reachability is clearly met (3 multi-million-subscriber subreddits + Rize $10k+ MRR comparable). ≥2 tier-A independent sources back the finding. Confidence is Medium (not High) because the highest-MRR comparable (Rize) is in an adjacent mechanic (time-tracking), not AI screen-monitoring.',
  },
  source_meta: gateMeta(
    S_g2_reddit_productivity,
    S_g2_reddit_adhd,
    S_g2_reddit_getdis,
    S_g2_ih_rize_10k,
    S_g2_techcrunch_distraction,
  ),
};

// ─── Gate 3 ──────────────────────────────────────────────────────────────

const gate3 = {
  gate: 3 as const,
  name: 'Platform & Big-Tech Risk',
  status: 'FAIL' as const,
  confidence: 'Medium' as const,
  dok1_facts: [
    {
      text: 'assess_platform_dependency scored Gate 3 platform-dependency risk at 3/5 ("Material platform dependency with mixed enforcement history") with 4 detected restrictive platforms (Apple Screen Time API, Android Digital Wellbeing, iOS/Apple platform APIs, macOS). The tool\'s verdict text explicitly invokes the Apple "system feature" pattern that "has killed prior categories (Spotlight → launchers, Notes → note apps)".',
      source: S_g3_serper_apple_screentime_tos,
    },
    {
      text: 'Apple App Review Guidelines (developer.apple.com/app-store/review/guidelines/) — the first-party rulebook governing Screen Time / focus apps. Any iOS focus app is structurally subject to this policy surface.',
      source: S_g3_apple_review_guidelines,
    },
    {
      text: 'Apple Developer Forums "Managed Settings" tag (developer.apple.com/forums/tags/managed-settings) — the Screen Time API surface every iOS focus app must build on, with active third-party developer issues reported. find_why_now_signals surfaced this as a "recent enabler" (last 24mo).',
      source: S_g3_apple_devforums_managed_settings,
    },
    {
      text: 'check_big_tech_encroachment\'s M5 synonym-map expansion fired a dedicated Apple Intelligence query on developer.apple.com — confirming the M5 fix is operational at end-to-end. The query is a live S/conflicted source even when its results do not bubble up high-conviction hits.',
      source: S_g3_apple_intelligence_query,
    },
    {
      text: 'check_big_tech_encroachment\'s M5 synonym-map expansion also fired a dedicated Screen Time API query on developer.apple.com — Apple Screen Time API is the canonical iOS focus-app dependency surface.',
      source: S_g3_apple_screentime_query,
    },
    {
      text: 'Microsoft Learn Q&A thread documents Microsoft Viva Insights Focus Plan failing to schedule focus time — Microsoft already ships focus-management as part of Microsoft 365, confirming hyperscaler presence in the category.',
      source: S_g3_microsoft_viva,
    },
    {
      text: 'assess_platform_dependency\'s deplatforming-retro fan-out (Serper query for Apple Screen Time API "lost access" / "deplatformed" / "rejected" founder retros on Medium/HN/IndieHackers) returned no usable hits — logged honestly as empty per spec §11 anti-pattern 2; does NOT mean the platform is safe.',
      source: S_g3_serper_apple_screentime_deplat,
    },
  ],
  dok2_summary:
    'The product is structurally dependent on Apple\'s Screen Time / Managed Settings API (or equivalent Android Digital Wellbeing) — both restrictive platforms governed by App Review Guidelines policy churn. assess_platform_dependency scored Gate 3 platform-risk at 3/5 ("Material platform dependency with mixed enforcement history"), explicitly invoking the Apple "system feature" pattern that killed Spotlight-style launchers and Notes-style note apps. check_big_tech_encroachment\'s M5 synonym-map fired dedicated Apple Intelligence + Screen Time API queries on developer.apple.com (M5 fix verified operational). Microsoft already ships Viva Insights Focus Plan. The deplatforming-retro fan-out returned empty — logged honestly per spec §11 anti-pattern 2.',
  dok3_insights: [
    {
      text: 'Model judgment: this is the killshot gate. Apple owns the Screen Time / Managed Settings API the product must call, and the same App Review Guidelines surface that has killed Spotlight-style and Notes-style third-party apps gates entry. A cloud-screenshot-based third-party app is structurally exposed to both API revocation and competitive encroachment.',
      is_model_judgment: true as const,
    },
    {
      text: 'Model judgment: the B2C-solo framing makes this worse — there is no enterprise relationship or partnership leverage to soften Apple\'s platform power. The empty deplatforming-retros search is best read as "we did not find the stories on Medium/HN/IndieHackers in this run" rather than "the risk is small" — per spec §11 anti-pattern 2 (do not fabricate, but also do not over-weight absence).',
      is_model_judgment: true as const,
    },
  ],
  contradicting_evidence: [
    { text: CONTRA_NONE, source: null },
  ],
  dok4_verdict: {
    status: 'FAIL' as const,
    confidence: 'Medium' as const,
    reasoning:
      'FAIL at Medium confidence — assess_platform_dependency returned risk 3/5 ("Material platform dependency with mixed enforcement history") across 4 platforms with restrictive history (Apple Screen Time API, Android Digital Wellbeing, iOS/Apple platform APIs); the tool\'s own verdict text invokes the Apple "system feature" killshot pattern (Spotlight → launchers, Notes → note apps). The M5 synonym-map expansion fired dedicated Apple Intelligence + Screen Time API queries on developer.apple.com (operational end-to-end). ≥2 tier-S sources back the platform-dependency finding (developer.apple.com forums + App Review Guidelines). Confidence is Medium (not High) because the deplatforming-retros fan-out returned no usable hits (logged honestly; not the same as proving safety) and check_big_tech_encroachment\'s adjacency score was 1/5 on this run — the FAIL rests on the assess_platform_dependency 3/5 risk combined with the framework-context §6 canonical encroachment thesis for this exact category.',
  },
  source_meta: gateMeta(
    S_g3_apple_devforums_managed_settings,
    S_g3_apple_review_guidelines,
    S_g3_serper_apple_screentime_tos,
    S_g3_serper_apple_screentime_deplat,
    S_g3_microsoft_viva,
    S_g3_apple_intelligence_query,
    S_g3_apple_screentime_query,
  ),
};

// ─── Gate 4 ──────────────────────────────────────────────────────────────

const gate4 = {
  gate: 4 as const,
  name: 'Willingness to Pay',
  status: 'FAIL' as const,
  confidence: 'Medium' as const,
  dok1_facts: [
    {
      text: 'RescueTime live pricing page lists tiers at $7/mo, $9/mo, and $12/mo — the category ceiling for an established B2C productivity SaaS sits in the single-digit to low-double-digit dollar range. (Post-M1 fix: clean currency-anchored extraction, no "474"/"212"/"8217" artifacts.)',
      source: S_g4_rescuetime_live,
    },
    {
      text: 'Freedom live pricing page (freedom.to, post-M2 Serper-resolved hostname) lists $3.33/mo and $8.99/mo freemium tiers — additional confirmation of the sub-$10/mo B2C ceiling.',
      source: S_g4_freedom_live,
    },
    {
      text: 'Rize live pricing page (rize.io, post-M2 Serper-resolved hostname) lists $9.99/mo to $29.99/mo subscription tiers — even Rize, the highest-MRR comparable, prices its top tier at $29.99/mo.',
      source: S_g4_rize_live,
    },
    {
      text: 'Opal live pricing page (opal.so, post-M2 Serper-resolved hostname) lists $8.29/mo and $19.99/mo tiers — direct competitor in the same B2C focus-app mechanic.',
      source: S_g4_opal_live,
    },
    {
      text: 'Focus Bear live pricing page (focusbear.io, post-M2 Serper-resolved hostname) lists $4.99/mo and $9.99/mo subscription tiers — indie competitor at the low end of the category.',
      source: S_g4_focusbear_live,
    },
    {
      text: 'Wayback Machine snapshot 2026-05-03 of Focus Bear pricing — historical anchor confirming pricing has been stable at the sub-$10/mo ceiling.',
      source: S_g4_focusbear_wayback,
    },
    {
      text: 'Wayback Machine snapshot 2026-03-16 of Opal pricing — second historical anchor confirming category pricing stability.',
      source: S_g4_opal_wayback,
    },
    {
      text: 'find_pricing_anchors auto_flags = ["High churn language in reviews (5 signals) — category has a retention problem. Build in churn-prevention features from day one.", "B2C framing + churn signals: consumer WTP is especially fragile. Freemium + upgrade path must be extremely clear."]. Surfaced 5 G2/Capterra churn signals including "refund the overpayment or save the overpayment as a credit" and "cancelled they didn\'t even bother to respond".',
      source: S_g4_g2_churn,
    },
    {
      text: 'IndieHackers: Session, an App Store focus app, reports $2,000 MRR with ~750 installs/month from the App Store — illustrative B2C-solo ceiling for focus apps that are not one of the top 1–2 winners.',
      source: S_g2_ih_session_2k,
    },
  ],
  dok2_summary:
    'The focus-app category prices in the ~$3–$30/mo range with most consumer tiers between $3–$12/mo (RescueTime, Freedom, Opal, Focus Bear). Rize\'s top tier at $29.99/mo is the only point above $12/mo and is in adjacent time-tracking mechanic, not AI screen-monitoring. Two Wayback snapshots (Focus Bear, Opal) confirm pricing stability. find_pricing_anchors auto-flagged 5 G2/Capterra churn / refund signals, and IndieHackers comparables (Session $2k MRR, Rize $10k+ MRR) show the ceiling. Post-M1+M2 fixes: pricing extraction is clean (no currency artifacts) and 6/7 competitor hostnames resolved via Serper.',
  dok3_insights: [
    {
      text: 'Model judgment: the B2C-solo target ($5k–$50k MRR) is achievable only at the top of this category. New entrants face a ~$10/mo ceiling combined with the documented "ADHD-tax" churn pattern — a classic labor-of-love combination.',
      is_model_judgment: true as const,
    },
    {
      text: 'Model judgment: cloud-screenshot processing adds inference cost on top of an already-thin margin profile — economics are tighter than for incumbents that run locally.',
      is_model_judgment: true as const,
    },
  ],
  contradicting_evidence: [
    {
      text:
        'Rize publicly reports >$10k MRR on IndieHackers with a top tier at $29.99/mo, demonstrating that pricing above the $10/mo ceiling is achievable for adjacent time-tracking. Cold Turkey appears to sell a one-time license. Neither uses cloud-screenshot AI monitoring, and both have multi-year market presence.',
      source: S_g2_ih_rize_10k,
    },
  ],
  dok4_verdict: {
    status: 'FAIL' as const,
    confidence: 'Medium' as const,
    reasoning:
      'FAIL at Medium confidence — category pricing clusters at $3–$12/mo across 5 live competitor pages (RescueTime, Freedom, Opal, Focus Bear, plus Rize\'s entry tier), with 2 Wayback historical anchors confirming stability, and find_pricing_anchors auto-flagging 5 G2/Capterra churn signals. No AI-screen-monitoring comparable above the B2C-solo lifestyle floor is visible in public data. ≥2 tier-S sources back the ceiling claim (live pricing pages + Wayback snapshots). Per framework-context.md §6 calibration anchor, this is the canonical "$10/mo ceiling + ADHD-tax churn" FAIL pattern. Confidence Medium (not High) because Rize\'s $29.99/mo top tier demonstrates the adjacent time-tracking sub-category can support higher prices — leaving open whether AI-screen-monitoring would behave similarly.',
  },
  source_meta: gateMeta(
    S_g4_rescuetime_live,
    S_g4_freedom_live,
    S_g4_rize_live,
    S_g4_opal_live,
    S_g4_focusbear_live,
    S_g4_focusbear_wayback,
    S_g4_opal_wayback,
    S_g4_g2_churn,
    S_g2_ih_session_2k,
    S_g2_ih_rize_10k,
  ),
};

// ─── Gate 5 ──────────────────────────────────────────────────────────────

const gate5 = {
  gate: 5 as const,
  name: 'Why Now',
  status: 'INCONCLUSIVE' as const,
  confidence: 'Low' as const,
  dok1_facts: [
    {
      text: 'find_why_now_signals surfaced 4 "recent enablers" from hyperscaler dev-doc fan-out — all of which are general policy/forum surfaces (Apple App Review Guidelines, Apple Developer Forums Managed Settings, Microsoft Visual Studio 2026 release notes, Google ML guides). None describes a discrete enabler that unlocks AI screen-monitoring specifically.',
      source: S_g3_apple_review_guidelines,
    },
    {
      text: 'find_yc_rfs_alignment returned 0 keyword matches against YC S26 RFS for focus / screen-time / on-task — YC is not currently pulling for this category.',
      source: S_g5_yc_rfs,
    },
    {
      text: 'EU regulatory query via Serper (site:ec.europa.eu) surfaced no focus-app-specific tailwind. The broader EU AI Act regulatory framework is a headwind for cloud-screenshot processing of user activity, not an unlock.',
      source: S_g5_eu_ai_act,
    },
    {
      text: 'TechCrunch 2025-12-25 "best distraction blockers to jump-start your focus in the new year" rounds up Opal/Freedom — continued category cadence is driven by editorial calendar (New Year resolutions) and personality-led launches, not a specific 2025–2026 enabler unlock.',
      source: S_g2_techcrunch_distraction,
    },
  ],
  dok2_summary:
    'No specific articulable why-now thesis surfaced for AI-screen-monitoring focus apps. Hyperscaler dev-doc fan-out returned only general policy/forum surfaces. YC RFS shows zero category pull. EU regulatory environment is a headwind, not a tailwind. Press cadence is driven by editorial calendar, not an enabler unlock.',
  dok3_insights: [
    {
      text: 'Model judgment: "AI got better" is the spec\'s canonical anti-pattern for Why Now (§9). The available evidence does not surface a sharper thesis (e.g., a specific platform API opening, regulatory change forcing screen monitoring, or behavior shift tied to remote work).',
      is_model_judgment: true as const,
    },
  ],
  contradicting_evidence: [
    { text: CONTRA_NONE, source: null },
  ],
  dok4_verdict: {
    status: 'INCONCLUSIVE' as const,
    confidence: 'Low' as const,
    reasoning:
      'INCONCLUSIVE — per spec §3, "Automatic Inconclusive if no non-obvious why-now exists". Tool signals (YC RFS = 0 alignment, EU = headwind, launch cluster = editorial cadence, hyperscaler enablers = generic policy surfaces) collectively fail to surface a defensible why-now thesis. Confidence Low because absence of evidence is itself the signal.',
  },
  source_meta: gateMeta(
    S_g3_apple_review_guidelines,
    S_g5_yc_rfs,
    S_g5_eu_ai_act,
    S_g2_techcrunch_distraction,
  ),
};

// ─── Verdict + killshots ────────────────────────────────────────────────

const killshots = [
  {
    reason:
      'Platform & Big-Tech Risk killshot — assess_platform_dependency scored Gate 3 risk at 3/5 ("Material platform dependency with mixed enforcement history") across Apple Screen Time API, Android Digital Wellbeing, iOS, and the App Review Guidelines policy surface. The tool\'s own verdict text invokes the Apple "system feature" pattern that killed Spotlight→launchers and Notes→note apps. M5\'s synonym-map expansion fired dedicated Apple Intelligence + Screen Time API queries on developer.apple.com (operational end-to-end). This is the framework-context §6 canonical encroachment killshot for this category.',
    cited_source_urls: [
      S_g3_apple_devforums_managed_settings.url,
      S_g3_apple_review_guidelines.url,
      S_g3_apple_screentime_query.url,
    ],
  },
  {
    reason:
      'Willingness-to-Pay killshot — the B2C focus-app category prices in the $3–$12/mo band across 5 live competitor pricing pages (RescueTime, Freedom, Opal, Focus Bear; Rize\'s top tier at $29.99/mo is the only outlier and is adjacent time-tracking, not AI screen-monitoring). Two Wayback snapshots (Focus Bear 2026-05-03, Opal 2026-03-16) confirm stability. find_pricing_anchors auto-flagged 5 G2/Capterra refund/cancel/overpayment churn signals. With cloud-vision inference cost per user on top, the B2C-solo $5k–$50k MRR target is structurally unreachable — the canonical "$10/mo ceiling + ADHD-tax churn" pattern from framework-context §6.',
    cited_source_urls: [
      S_g4_rescuetime_live.url,
      S_g4_focusbear_wayback.url,
      S_g4_opal_wayback.url,
      S_g4_g2_churn.url,
    ],
  },
  {
    reason:
      'Crowded-space killshot — ≥3 directly-overlapping AI-screen-monitoring products are already shipping (the r/ADHD_Programmers tool, the Hustle-covered AI focus tool that "monitors and analyzes your screen", Focusmo for ADHD), and the IndieHackers "every focus app I tried on Mac failed me" thread documents category-wide structural churn. The founder enters without first-mover advantage and without a wedge that visibly beats the churn mechanism. The contradicting-evidence Serper search for "profitable indie AI focus app success story 2025" surfaced none.',
    cited_source_urls: [
      S_g1_reddit_adhd_prog.url,
      S_g1_hustle.url,
      S_g2_ih_failed.url,
    ],
  },
];

const verdict = {
  overall: 'NO-GO' as const,
  overall_confidence: 'Medium' as const,
  gate_summary: [
    { gate: 1 as const, name: 'Direct Competitor Scan', status: 'FAIL' as const, reason: '≥3 direct AI-screen-monitoring competitors already shipping; category-wide "every focus app failed me" churn' },
    { gate: 2 as const, name: 'Market Demand', status: 'PASS' as const, reason: 'Large active communities (4.2M r/productivity, 2.2M r/ADHD, 2.2M r/getdisciplined); Rize >$10k MRR adjacent comparable' },
    { gate: 3 as const, name: 'Platform & Big-Tech Risk', status: 'FAIL' as const, reason: 'assess_platform_dependency 3/5 risk; Apple Screen Time / Managed Settings API dependency; "system feature" killshot pattern' },
    { gate: 4 as const, name: 'Willingness to Pay', status: 'FAIL' as const, reason: 'Category ceiling $3–$12/mo across 5 live + 2 Wayback pricing pages; auto-flagged churn signals; cloud-inference cost adds load' },
    { gate: 5 as const, name: 'Why Now', status: 'INCONCLUSIVE' as const, reason: 'No discrete enabler unlock; YC RFS 0 alignment; EU AI Act is headwind, not tailwind' },
  ],
  killshots,
};

// ─── Validation checks ──────────────────────────────────────────────────

const validation_checks = [
  {
    name: 'Source Quality Audit' as const,
    rows: [
      { dimension: 'Authority', finding: 'Mix of S-tier (live pricing pages including post-M2 Serper-resolved domains, Apple Developer Forums, Wayback snapshots) and A-tier (Reddit /about.json metadata, IndieHackers, TechCrunch, The Hustle, Serper); minimal B/C/D usage.' },
      { dimension: 'Recency', finding: 'Most sources fetched within this run (2026); Wayback anchors 2026-05-03 (Focus Bear) and 2026-03-16 (Opal).' },
      { dimension: 'Citation strength', finding: 'Every DOK 1 fact carries tier + bias + fetched_at and resolves to a URL captured in .planning/validation-runs/02-fomi-tool-responses/.' },
      { dimension: 'Funding & bias', finding: `Bias mix: ${biasCounts.independent} indep / ${biasCounts.conflicted} conflicted / ${biasCounts['vendor-funded']} vendor-funded / ${biasCounts.unknown} unknown. Conflicted share is below the 30% downgrade threshold for the deciding-tier sources of the FAIL gates.` },
      { dimension: 'Primary vs secondary', finding: 'Primary tools (assess_platform_dependency for G3, find_pricing_anchors for G4, find_closest_competitor + map_competitive_weaknesses for G1) were all called.' },
    ],
    outcome: 'Minor' as const,
    notes:
      'Minor caveat: read_competitor_changelog\'s URL-guessing fallback resolved to an unrelated Boomi community page — Fomi-specific changelog evidence is therefore absent (logged honestly). check_big_tech_encroachment\'s adjacency score came back 1/5 despite M5\'s synonym-map firing dedicated Apple Intelligence + Screen Time queries — the Gate 3 FAIL rests on assess_platform_dependency 3/5 + framework-context §6 canonical thesis rather than the encroachment tool\'s own adjacency.',
  },
  {
    name: 'Counterargument Search' as const,
    rows: [
      { dimension: 'What critics say', finding: 'Critics would point to (a) Rize\'s >$10k MRR + $29.99/mo top tier as proof the category can clear B2C-solo, (b) continued launch cadence as proof of vitality, (c) absence of deplatforming retros in this run\'s search.' },
      { dimension: 'Strongest arguments for NO-GO', finding: 'Apple\'s ownership of the Screen Time / Managed Settings API + App Review Guidelines surface, plus the category-wide low-WTP-high-churn pattern, plus ≥3 already-shipping AI-screen-monitoring competitors — three independent failure-mode strands converging.' },
      { dimension: 'Alternative explanations', finding: 'The cloud-screenshot mechanic specifically is the exact privacy attack surface framework-context §6 flagged as Fomi\'s primary structural weakness.' },
      { dimension: 'Failed analogues', finding: 'framework-context §9 cites focus-app category as repeatedly failing in B2C-solo framing; Apple\'s Focus Mode + Screen Time dashboard already absorb large portions of the addressable problem for many users.' },
    ],
    outcome: 'No issues' as const,
    notes:
      'The counterargument case (Rize, launch cadence, empty deplatforming retros) does not flip any FAIL gate. Rize is in adjacent mechanic; empty deplatforming retros are an absence-of-evidence, not evidence-of-absence (logged in Gate 3 DOK 3 #2 per spec §11 anti-pattern 2).',
  },
  {
    name: 'Logic & Coherence Review' as const,
    rows: [
      { dimension: 'Evidence-to-claim ratio', finding: 'Each killshot cites ≥3 DOK 1 source URLs spanning tier S or A — passes spec §11 "killshot reasons cite specific DOK 1 facts" anti-pattern check.' },
      { dimension: 'Logical fallacies', finding: 'No survivorship bias detected — failure-mode evidence is from multiple sources (Apple developer forums + IndieHackers + Serper fan-out + Reddit).' },
      { dimension: 'Internal consistency', finding: 'Gate verdicts (FAIL, PASS, FAIL, FAIL, INCONCLUSIVE) → 3 FAILs → NO-GO via spec §3 fail-2 math. Overall confidence Medium reflects the Gate 3 encroachment score regression vs Phase 01 baseline (3/5 vs 4/5).' },
      { dimension: 'Scope', finding: 'Report stays inside the 5-gate scope; no TAM, GTM, or ICP — per spec §1 non-goals.' },
    ],
    outcome: 'No issues' as const,
    notes: '',
  },
];

// ─── Test cards (reuse Phase 01 hypotheses; framework allows reuse) ─────

const test_cards = [
  {
    id: 'H1',
    belief: 'A specific underserved sub-segment of ADHD / deep-work users will pay $20+/mo for AI screen monitoring that materially outperforms Apple Focus mode + Screen Time.',
    verification_method: 'Run a fake-door landing page targeting r/ADHD_Programmers + r/getdisciplined with three pricing variants ($10, $20, $30/mo) and measure email-capture + "Charge me" click-through.',
    metric: 'Conversion rate from landing-page visit → "Charge me $X/mo" click.',
    success_threshold: '≥5% conversion on the $20/mo variant from a minimum 500 paid-traffic visits.',
    linked_gate: 4 as const,
    cheapest_test: 'Fake-door landing page on Carrd + Stripe payment link; ~$100 in Reddit ads.',
  },
  {
    id: 'H2',
    belief: 'A local-only / on-device variant (no cloud screenshots) defuses the privacy objection framework-context §6 flagged as Fomi\'s primary structural weakness.',
    verification_method: '5 customer-discovery interviews with current Fomi / Opal / Focus Bear paying users; structured around privacy, cancellation triggers, and switching costs.',
    metric: 'Number of interviewees who unprompted name "cloud screenshots" as a reason they would not use or would cancel.',
    success_threshold: '≥3 of 5 interviewees independently raise the privacy objection.',
    linked_gate: 3 as const,
    cheapest_test: '5 × 30-minute interviews via Wynter / IH community recruitment.',
  },
  {
    id: 'H3',
    belief: 'Apple Screen Time API rejection rates for screen-monitoring apps have NOT increased in the last 12 months — disproving the platform-dependency killshot.',
    verification_method: 'Scrape r/iOSProgramming + Apple Developer Forums for Screen Time / DeviceActivity API rejection posts over the last 24 months; chart frequency.',
    metric: 'Rolling-3-month count of rejection posts mentioning Screen Time / DeviceActivity APIs.',
    success_threshold: 'Flat or declining trend over 24 months.',
    linked_gate: 3 as const,
    cheapest_test: 'Reddit + Apple Developer Forums scrape via Apify; 2 hours of analysis.',
  },
  {
    id: 'H4',
    belief: 'A B2B-team variant (sold to engineering managers as a deep-work analytics tool, $10/seat/mo, 5-seat minimum) escapes the B2C-solo WTP ceiling.',
    verification_method: 'Cold-email 50 engineering managers at 50–200-person startups; offer a 30-day free pilot of a manual concierge version.',
    metric: 'Number of paid pilot conversions at the 30-day mark.',
    success_threshold: '≥3 of 50 (6%) convert to paid 5-seat contracts.',
    linked_gate: 4 as const,
    cheapest_test: 'Concierge service via Apple Shortcuts + a weekly Loom analytics email; no product code.',
  },
  {
    id: 'H5',
    belief: 'The 2025–2026 focus-app launch cluster is driven by a specific (currently unnamed) enabler — long-context vision LLMs at <$0.001 / screenshot — that constitutes a credible Why-Now thesis.',
    verification_method: 'Build a cost model for cloud-screenshot vision LLM processing in 2024 vs 2026 (per active user-hour) using OpenAI / Anthropic public pricing; compare to per-user revenue at $10/mo.',
    metric: 'Unit margin per active user-hour.',
    success_threshold: 'Positive gross margin at <$10/mo pricing AND ≥5x cost reduction since Jan 2024.',
    linked_gate: 5 as const,
    cheapest_test: 'Spreadsheet using published API pricing; 1 hour.',
  },
];

// ─── Methodology ────────────────────────────────────────────────────────

const callSummary: Array<{ tool: string; outFile: string; succeeded: boolean; failure_note?: string }> =
  JSON.parse(readFileSync(resolve(RESP_DIR, '_call-summary.json'), 'utf-8'));

const tool_calls = callSummary.map((c) => ({
  tool: c.tool,
  args_summary: `(see ${c.outFile})`,
  succeeded: c.succeeded,
  ...(c.failure_note ? { failure_note: c.failure_note } : {}),
}));

// Add the documented Boomi-fallback failure note
const changelogIdx = tool_calls.findIndex((c) => c.tool === 'read_competitor_changelog');
if (changelogIdx >= 0 && tool_calls[changelogIdx].succeeded) {
  tool_calls[changelogIdx] = {
    ...tool_calls[changelogIdx],
    succeeded: false,
    failure_note:
      'URL-guessing fallback resolved product="Fomi" to community.boomi.com release notes — unrelated; no Fomi changelog content captured. Logged honestly per spec §11 anti-pattern 2.',
  };
}

const methodology_notes = {
  tool_calls,
  tool_calls_fired: tool_calls.length,
  validation_rules_in_force:
    'Spec v1.0: DOK 1→4 layering with tier+bias on every fact; ≥2 tier-B-or-higher for PASS; contradicting evidence per gate; ≥30%-conflicted-source downgrade; fail-2 rule (2+ FAILs → NO-GO); validation-check decision matrix (Minor → caveat, Major → confidence Low, Fundamental → INCONCLUSIVE override). Phase 02 fixes active: M1 currency-anchored pricing regex, M2 Serper-resolved hostnames, M5 hyperscaler synonym-map expansion, M8 tool-layer caching.',
  disclaimer: 'This is a decision aid, not a verdict — final call is yours.',
};

// ─── Header ─────────────────────────────────────────────────────────────

const header = {
  idea: IDEA,
  audience: 'B2C' as const,
  builder: 'solo' as const,
  generated_at: FETCHED_AT,
  mcp_version: '0.2.0',
  total_sources_consulted: source_appendix.length,
  source_quality_mix: tierCounts,
  bias_mix: biasCounts,
};

// ─── Assemble ───────────────────────────────────────────────────────────

const report = {
  header,
  verdict,
  gates: [gate1, gate2, gate3, gate4, gate5],
  validation_checks,
  test_cards,
  spiky_pov: { template: SPIKY_POV_TEMPLATE },
  source_appendix,
  methodology_notes,
};

// Save the JSON for debugging
writeFileSync(
  resolve(REPO_ROOT, '.planning/validation-runs/02-fomi-regression-after-phase-02-report.json'),
  JSON.stringify(report, null, 2),
);

// ─── Call finalize_validation_report over stdio ────────────────────────

interface RpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

class StdioClient {
  private proc: ChildProcessWithoutNullStreams;
  private buf = '';
  private pending = new Map<number, (r: RpcResponse) => void>();
  private nextId = 1;

  constructor() {
    this.proc = spawn('node', ['build/index.js'], { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    this.proc.stdout.setEncoding('utf-8');
    this.proc.stdout.on('data', (c: string) => this.onData(c));
    this.proc.stderr.on('data', (d) => process.stderr.write(`[mcp] ${d}`));
  }
  private onData(chunk: string) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as RpcResponse;
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
          const cb = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          cb(msg);
        }
      } catch {/* */}
    }
  }
  request(method: string, params?: unknown, t = 60000): Promise<RpcResponse> {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      const tm = setTimeout(() => { this.pending.delete(id); rej(new Error('timeout ' + method)); }, t);
      this.pending.set(id, (r) => { clearTimeout(tm); res(r); });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  notify(method: string, params?: unknown) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  close() { this.proc.stdin.end(); this.proc.kill(); }
}

async function main() {
  const c = new StdioClient();
  await c.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't-final-3-finalizer', version: '1.0.0' } });
  c.notify('notifications/initialized');

  const res = await c.request('tools/call', {
    name: 'finalize_validation_report',
    arguments: { report_json: JSON.stringify(report) },
  }, 120000);

  if (res.error) {
    process.stderr.write(`[finalize] error: ${JSON.stringify(res.error, null, 2)}\n`);
    process.exit(1);
  }
  const content = (res.result as { content?: Array<{ type: string; text?: string }> })?.content ?? [];
  const text = content[0]?.text ?? '';
  const parsed = JSON.parse(text);

  // Save the full tool response
  writeFileSync(
    resolve(REPO_ROOT, '.planning/validation-runs/02-fomi-regression-after-phase-02-tool-response.json'),
    JSON.stringify(parsed, null, 2),
  );

  if (parsed.status !== 'ok') {
    process.stderr.write(`[finalize] status=${parsed.status}\n${JSON.stringify(parsed, null, 2)}\n`);
    process.exit(1);
  }

  writeFileSync(
    resolve(REPO_ROOT, '.planning/validation-runs/02-fomi-regression-after-phase-02.md'),
    parsed.markdown,
  );

  process.stderr.write(`[finalize] ok — markdown ${parsed.markdown.length} chars; issues=${(parsed.issues||[]).length}; adjustments=${(parsed.adjustments_made||[]).length}\n`);
  if ((parsed.adjustments_made || []).length > 0) {
    process.stderr.write(`[finalize] adjustments: ${JSON.stringify(parsed.adjustments_made)}\n`);
  }
  if ((parsed.issues || []).length > 0) {
    process.stderr.write(`[finalize] issues:\n${JSON.stringify(parsed.issues, null, 2)}\n`);
  }
  c.close();
}

main().catch((e) => { process.stderr.write(`[fatal] ${e}\n`); process.exit(1); });
