// assess_platform_dependency — Gate 3 (Platform / Moat Risk) P1 tool.
//
// Sibling to check_big_tech_encroachment. Where that tool asks "is a
// hyperscaler about to ship this?", this tool asks: "does this product
// SIT ON TOP of a platform that can change the rules or revoke access?"
//
// Pipeline:
//   1. Detect platform dependencies — either from `explicit_platforms` (user
//      knows their stack) or by substring-matching `idea_description + category`
//      against the static PLATFORM_KEYWORDS map.
//   2. For each detected platform, fan out two Serper searches (parallel):
//        a. Recent ToS-change news on / about the platform.
//        b. Founder retros where someone lost access to that platform.
//   3. Score `gate3_platform_risk_score` 1..5 mirroring
//      check_big_tech_encroachment's adjacency scale.
//   4. Adjust for framing: dev_tools = harsher Gate 3 (spec §9 / §11 row
//      "dev_tools + solo: Adjacency threshold lowered (2+ triggers concern)").
//      B2C + solo = emphasize App Store risk. B2B + funded = acknowledge
//      acquisition-as-opportunity reframe.
//
// Source tiers per spec §4 / §7:
//   - Official ToS docs (developer.apple.com, etc.) → tier S, bias CONFLICTED
//     (platform self-publishes its own terms — has stake in framing).
//   - Press coverage of policy enforcement → tier A, bias INDEPENDENT.
//   - Founder retros (blog posts / HN / Indie Hackers / Medium) → tier A,
//     bias CONFLICTED (first-person, dramatic, stake against the platform).
//
// Honest empties: if Serper returns nothing for a query, the corresponding
// array stays empty and confidence_note discloses it. Never fabricates a
// deplatforming story.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult, ToolSource } from '../types.js';
import {
  serperSearch,
  isSerperLive,
  type SerperOrganicResult,
} from '../lib/serper.js';
import { effectiveBias, requiresUpgradeFromUnknown } from '../lib/bias.js';
import { PLATFORM_KEYWORDS, type PlatformEntry } from '../lib/platform-keywords.js';

type DetectionSource = 'explicit_input' | 'inferred_from_idea';
type RiskScore = 1 | 2 | 3 | 4 | 5;

interface DetectedPlatform {
  name: string;
  evidence: string;
  detection_source: DetectionSource;
  restrictive_history: boolean;
}

interface TosHistorySignal {
  platform: string;
  finding: string;
  url: string;
  snippet: string;
}

interface DeplatformingRetro {
  platform: string;
  founder_or_company: string;
  url: string;
  snippet: string;
}

interface AssessPlatformDependencyData {
  detected_platforms: DetectedPlatform[];
  tos_history_signals: TosHistorySignal[];
  deplatforming_retros: DeplatformingRetro[];
  single_platform_dependency_ratio: number;
  gate3_platform_risk_score: RiskScore;
  gate3_platform_risk_label: string;
  verdict: string;
}

const CURRENT_YEAR = new Date().getFullYear();

// ───────────────────────────────────────────────────────────────────────────
// Detection — explicit input wins; otherwise substring scan over keyword map.
// ───────────────────────────────────────────────────────────────────────────

function detectFromExplicit(explicit: string[]): DetectedPlatform[] {
  // Try to map each explicit string back to a known entry for restrictive_history;
  // if no match, still surface the raw name (user knows their stack better than
  // our static table).
  const out: DetectedPlatform[] = [];
  for (const raw of explicit) {
    const needle = raw.toLowerCase();
    const matched = PLATFORM_KEYWORDS.find(
      (p) =>
        p.platform.toLowerCase() === needle ||
        p.triggers.some((t) => needle.includes(t) || t.includes(needle)),
    );
    out.push({
      name: matched?.platform ?? raw,
      evidence: `Provided in explicit_platforms input: "${raw}"`,
      detection_source: 'explicit_input',
      restrictive_history: matched?.restrictive ?? false,
    });
  }
  // De-dupe by canonical name.
  const seen = new Set<string>();
  return out.filter((p) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
}

function detectFromIdea(ideaText: string): DetectedPlatform[] {
  const haystack = ideaText.toLowerCase();
  const hits: DetectedPlatform[] = [];
  for (const entry of PLATFORM_KEYWORDS) {
    const trigger = entry.triggers.find((t) => haystack.includes(t));
    if (trigger) {
      hits.push({
        name: entry.platform,
        evidence: `Inferred from substring match: "${trigger}" in idea/category text`,
        detection_source: 'inferred_from_idea',
        restrictive_history: entry.restrictive,
      });
    }
  }
  // De-dupe (same trigger can appear across multiple entries' triggers[] —
  // unlikely but safe).
  const seen = new Set<string>();
  return hits.filter((p) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
}

function resolveEntry(name: string): PlatformEntry | undefined {
  return PLATFORM_KEYWORDS.find((p) => p.platform === name);
}

// ───────────────────────────────────────────────────────────────────────────
// Per-platform Serper fetchers.
// ───────────────────────────────────────────────────────────────────────────

async function fetchTosHistory(
  platform: DetectedPlatform,
): Promise<{ signals: TosHistorySignal[]; query: string; tier: ToolSource['tier']; bias: ToolSource['bias'] }> {
  // Use the platform name + a recent-year window. Mix of dev-docs (site:) and
  // free-text news. Single query keeps the Serper budget honest.
  const entry = resolveEntry(platform.name);
  const siteHint = entry ? ` OR site:${entry.tos_domain}` : '';
  const query = `"${platform.name}" (ToS OR "terms of service" OR "policy change" OR deprecation) ${CURRENT_YEAR} OR ${CURRENT_YEAR - 1}${siteHint}`;

  let results: SerperOrganicResult[] = [];
  try {
    results = await serperSearch(query, 5);
  } catch {
    return { signals: [], query, tier: isSerperLive() ? 'A' : 'D', bias: isSerperLive() ? 'independent' : 'unknown' };
  }
  // Treat as press/dev-docs mix. Tag the *source family* as tier A, bias
  // independent — individual hits that come from the official tos_domain are
  // still surfaced raw so the caller can re-classify if needed.
  if (!isSerperLive()) {
    return { signals: [], query, tier: 'D', bias: 'unknown' };
  }

  const signals: TosHistorySignal[] = [];
  for (const r of results) {
    if (r.title.startsWith('[STUB]')) continue;
    signals.push({
      platform: platform.name,
      finding: r.title,
      url: r.link,
      snippet: r.snippet,
    });
  }
  return { signals, query, tier: 'A', bias: 'independent' };
}

async function fetchDeplatformingRetros(
  platform: DetectedPlatform,
): Promise<{ retros: DeplatformingRetro[]; query: string; tier: ToolSource['tier']; bias: ToolSource['bias'] }> {
  // Founder retros live across medium.com, news.ycombinator.com, indiehackers.
  const query = `"${platform.name}" ("lost access" OR "deplatformed" OR "shut down" OR "kicked off" OR "banned" OR "rejected") founder OR retro OR postmortem site:medium.com OR site:news.ycombinator.com OR site:indiehackers.com`;

  let results: SerperOrganicResult[] = [];
  try {
    results = await serperSearch(query, 5);
  } catch {
    return { retros: [], query, tier: isSerperLive() ? 'A' : 'D', bias: isSerperLive() ? 'conflicted' : 'unknown' };
  }
  if (!isSerperLive()) {
    return { retros: [], query, tier: 'D', bias: 'unknown' };
  }

  const retros: DeplatformingRetro[] = [];
  for (const r of results) {
    if (r.title.startsWith('[STUB]')) continue;
    const founder = extractAuthorFromUrl(r.link) ?? r.title.split(/[—|–|-]/)[0]?.trim().slice(0, 80) ?? 'unknown';
    retros.push({
      platform: platform.name,
      founder_or_company: founder,
      url: r.link,
      snippet: r.snippet,
    });
  }
  return { retros, query, tier: 'A', bias: 'conflicted' };
}

function extractAuthorFromUrl(url: string): string | null {
  // medium.com/@author, news.ycombinator.com (no author), indiehackers.com/post/
  const med = /medium\.com\/@?([^\/\?#]+)/i.exec(url);
  if (med?.[1]) return `@${med[1]}`;
  const ih = /indiehackers\.com\/[a-z]+\/([^\/\?#]+)/i.exec(url);
  if (ih?.[1]) return ih[1];
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Scoring — mirror check_big_tech_encroachment's 1..5 scale.
//   5 — single-platform dep with recent ToS deaths + restrictive history
//   4 — single-platform dep on a known-restrictive platform
//   3 — primary platform dep with mixed history
//   2 — multi-platform support, no single dep dominant
//   1 — no platform dep detected / platform-agnostic
// ───────────────────────────────────────────────────────────────────────────

function scoreRisk(
  detected: DetectedPlatform[],
  tos: TosHistorySignal[],
  retros: DeplatformingRetro[],
  singleRatio: number,
): { score: RiskScore; label: string } {
  if (detected.length === 0) {
    return {
      score: 1,
      label: 'No platform dependency detected',
    };
  }
  const anyRestrictive = detected.some((p) => p.restrictive_history);
  const recentTos = tos.length >= 2;
  const anyRetros = retros.length >= 1;

  // 5 — single-platform + restrictive + recent ToS deaths
  if (singleRatio >= 0.95 && anyRestrictive && recentTos && anyRetros) {
    return {
      score: 5,
      label: 'Existential single-platform dependency on a restrictive platform with recent ToS deaths',
    };
  }
  // 4 — single-platform on a restrictive platform OR multi-platform but all restrictive with ToS signal
  if ((singleRatio >= 0.95 && anyRestrictive) || (anyRestrictive && recentTos)) {
    return {
      score: 4,
      label: 'Heavy dependency on a restrictive platform with documented enforcement history',
    };
  }
  // 3 — primary platform dep with mixed history (some retros OR restrictive but multi-platform)
  if (anyRestrictive || anyRetros) {
    return {
      score: 3,
      label: 'Material platform dependency with mixed enforcement history',
    };
  }
  // 2 — multi-platform support, no single dep dominant, no restrictive history
  if (detected.length >= 2) {
    return {
      score: 2,
      label: 'Multi-platform support reduces single-vendor risk',
    };
  }
  // 1 — single non-restrictive dep, no signal — still call it low.
  return {
    score: 1,
    label: 'Detected platform has no documented restrictive history',
  };
}

function adjustForFraming(
  base: { score: RiskScore; label: string },
  framing: Framing | undefined,
): { score: RiskScore; label: string; framingNote: string } {
  if (!framing) {
    return { ...base, framingNote: 'No framing provided — score is framing-neutral.' };
  }
  // dev_tools: lower the threshold by 1 → bump score up by 1 (cap at 5).
  if (framing.audience === 'dev_tools') {
    const bumped = Math.min(5, base.score + 1) as RiskScore;
    return {
      score: bumped,
      label: bumped !== base.score ? `${base.label} (dev_tools threshold lowered +1)` : base.label,
      framingNote:
        'dev_tools framing applied: Gate 3 threshold lowered by 1 per spec §9 (dev tools are absorbed into platforms more than any other category — OpenAI / GitHub / major cloud regularly ship built-in equivalents).',
    };
  }
  if (framing.audience === 'B2C' && framing.builder === 'solo') {
    return {
      score: base.score,
      label: base.label,
      framingNote:
        'B2C + solo framing: App Store policy risk dominates. Apple "system feature" pattern has killed prior categories (Spotlight → launchers, Notes → note apps).',
    };
  }
  if (framing.audience === 'B2B' && framing.builder === 'funded') {
    return {
      score: base.score,
      label: base.label,
      framingNote:
        'B2B + funded framing: acquisition-as-opportunity reframe applies — single-platform dep can be a feature (acquihire target) up to ~50% revenue concentration, becomes a VC red flag beyond.',
    };
  }
  return { ...base, framingNote: 'Framing provided but no special adjustment for this combination.' };
}

interface Framing {
  audience: 'B2B' | 'B2C' | 'B2B2C' | 'dev_tools';
  builder: 'solo' | 'small_team' | 'funded';
}

// ───────────────────────────────────────────────────────────────────────────
// Single-platform dependency ratio: rough estimate of "how concentrated"
// the dep is on the top platform.
//   - 0 platforms       → 0.0 (no dep)
//   - 1 platform        → 1.0 (fully concentrated)
//   - N>1 platforms     → 1 / N as a rough proxy for "even split"
// ───────────────────────────────────────────────────────────────────────────

function singlePlatformRatio(detected: DetectedPlatform[]): number {
  if (detected.length === 0) return 0;
  return 1 / detected.length;
}

// ───────────────────────────────────────────────────────────────────────────
// Source builder — one ToolSource per attempted (platform × family) pair.
// ───────────────────────────────────────────────────────────────────────────

function mkSource(
  query: string,
  tier: ToolSource['tier'],
  bias: ToolSource['bias'],
  contribution: string,
): ToolSource {
  return {
    url: `https://google.serper.dev/search?q=${encodeURIComponent(query)}`,
    tier,
    bias,
    fetched_at: new Date().toISOString(),
    contribution,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Registration
// ───────────────────────────────────────────────────────────────────────────

export function registerAssessPlatformDependency(server: McpServer): void {
  server.registerTool(
    'assess_platform_dependency',
    {
      description:
        'Gate 3 P1: assess platform dependency risk. Detects which platforms (App Store, Twitter API, Shopify, Chrome Web Store, OpenAI, etc.) the product sits on top of — either from explicit_platforms input or by inference from idea_description. For each, surfaces recent ToS-change news + founder deplatforming retros. Returns gate3_platform_risk_score 1..5 (5 = existential). Framing-aware: dev_tools framing lowers the risk threshold per spec §9. Never fabricates deplatforming stories.',
      inputSchema: {
        idea_description: z
          .string()
          .describe('Plain-language description of the product idea — scanned for platform mentions when explicit_platforms is omitted'),
        category: z
          .string()
          .describe('Product category, e.g. "focus app", "browser extension", "Slack bot"'),
        explicit_platforms: z
          .array(z.string())
          .optional()
          .describe('Optional explicit list of platforms the product depends on (e.g. ["Twitter API", "Shopify"]) — overrides inference'),
        framing: z
          .object({
            audience: z.enum(['B2B', 'B2C', 'B2B2C', 'dev_tools']),
            builder: z.enum(['solo', 'small_team', 'funded']),
          })
          .optional()
          .describe('Optional framing — adjusts risk threshold (dev_tools = harsher per spec §9)'),
      },
    },
    async ({ idea_description, category, explicit_platforms, framing }) => {
      const sources: ToolSource[] = [];
      const fallbacksUsed: string[] = [];

      // ─── Phase 1: detect platforms ────────────────────────────────────
      const detected: DetectedPlatform[] =
        explicit_platforms && explicit_platforms.length > 0
          ? detectFromExplicit(explicit_platforms)
          : detectFromIdea(`${idea_description} ${category}`);

      // Defensive short-circuit: no platforms → score 1 + helpful verdict.
      if (detected.length === 0) {
        const result: ToolResult<AssessPlatformDependencyData> = {
          data: {
            detected_platforms: [],
            tos_history_signals: [],
            deplatforming_retros: [],
            single_platform_dependency_ratio: 0,
            gate3_platform_risk_score: 1,
            gate3_platform_risk_label: 'No platform dependency detected',
            verdict:
              'No platform dependency detected from idea description or category. If you know your idea depends on a specific platform (e.g. Twitter API, App Store, Shopify), pass `explicit_platforms` and re-run for a real assessment.',
          },
          sources: [],
          confidence_note: `Substring-matched ${PLATFORM_KEYWORDS.length} known platforms against idea+category text — zero hits. No Serper calls fired (no platforms to investigate). Pass explicit_platforms to force a scan.`,
          fallbacks_used: ['no_platforms_detected (heuristic miss — pass explicit_platforms to override)'],
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // ─── Phase 2: per-platform Serper fan-out (parallel) ──────────────
      const tosFetches = detected.map((p) => fetchTosHistory(p));
      const retroFetches = detected.map((p) => fetchDeplatformingRetros(p));

      const [tosSettled, retrosSettled] = await Promise.all([
        Promise.allSettled(tosFetches),
        Promise.allSettled(retroFetches),
      ]);

      const tosSignals: TosHistorySignal[] = [];
      const retros: DeplatformingRetro[] = [];

      for (let i = 0; i < detected.length; i++) {
        const platform = detected[i]!;
        const tosResult = tosSettled[i];
        if (tosResult && tosResult.status === 'fulfilled') {
          tosSignals.push(...tosResult.value.signals);
          // Official ToS dev-docs page family is tier S / bias conflicted
          // (platform self-publishes its own terms — has framing stake per
          // spec §4 rule 6). We emit one S/conflicted source per platform to
          // represent that this family was considered.
          const entry = resolveEntry(platform.name);
          if (entry) {
            sources.push(
              mkSource(
                `site:${entry.tos_domain} terms of service`,
                isSerperLive() ? 'S' : 'D',
                isSerperLive() ? 'conflicted' : 'unknown',
                `Official ToS / dev-docs domain for ${platform.name} (${entry.tos_domain}) — platform self-published`,
              ),
            );
          }
          // The press-coverage family (mixed news + dev-docs results returned by
          // the broader query) is tier A / bias independent.
          sources.push(
            mkSource(
              tosResult.value.query,
              tosResult.value.tier,
              tosResult.value.bias,
              `Press / dev-docs ToS-change scan for ${platform.name} (${tosResult.value.signals.length} hit${tosResult.value.signals.length === 1 ? '' : 's'})`,
            ),
          );
        }
        const retroResult = retrosSettled[i];
        if (retroResult && retroResult.status === 'fulfilled') {
          retros.push(...retroResult.value.retros);
          sources.push(
            mkSource(
              retroResult.value.query,
              retroResult.value.tier,
              retroResult.value.bias,
              `Founder retro scan for ${platform.name} (${retroResult.value.retros.length} retro${retroResult.value.retros.length === 1 ? '' : 's'}) — bias 'conflicted' per spec §4 rule 6 (founder stake against platform)`,
            ),
          );
        }
      }

      if (!isSerperLive()) {
        fallbacksUsed.push('serper (stub — set SERPER_API_KEY for live ToS / retro data)');
      }

      // ─── Phase 3: score + framing adjust ──────────────────────────────
      const singleRatio = singlePlatformRatio(detected);
      const baseScore = scoreRisk(detected, tosSignals, retros, singleRatio);
      const adjusted = adjustForFraming(baseScore, framing);

      // ─── Phase 4: verdict ─────────────────────────────────────────────
      const restrictiveNames = detected.filter((p) => p.restrictive_history).map((p) => p.name);
      const verdictParts: string[] = [];
      verdictParts.push(
        `Gate 3 platform-dependency risk: ${adjusted.score}/5 — ${adjusted.label}.`,
      );
      verdictParts.push(
        `Detected ${detected.length} platform dep${detected.length === 1 ? '' : 's'}: ${detected.map((p) => p.name).join(', ')}.`,
      );
      if (restrictiveNames.length > 0) {
        verdictParts.push(
          `Restrictive history: ${restrictiveNames.join(', ')}.`,
        );
      }
      if (tosSignals.length > 0) {
        verdictParts.push(`${tosSignals.length} recent ToS / policy signal(s) surfaced.`);
      }
      if (retros.length > 0) {
        verdictParts.push(`${retros.length} founder retro(s) surfaced — read before committing.`);
      }
      if (adjusted.framingNote && framing) {
        verdictParts.push(adjusted.framingNote);
      }
      if (adjusted.score >= 4) {
        verdictParts.push('Treat Gate 3 as likely FAIL on dependency risk alone unless a credible multi-platform fallback exists.');
      } else if (adjusted.score === 3) {
        verdictParts.push('Treat Gate 3 as CONDITIONAL — corroborate with check_big_tech_encroachment before deciding.');
      }
      const verdict = verdictParts.join(' ');

      // ─── confidence_note — honest accounting ──────────────────────────
      const unknownCount = requiresUpgradeFromUnknown(sources);
      const conflictedCount = sources.filter(
        (s) => effectiveBias(s.bias) === 'conflicted',
      ).length;
      const independentCount = sources.filter(
        (s) => effectiveBias(s.bias) === 'independent',
      ).length;

      const noteParts: string[] = [];
      noteParts.push(
        `Detection: ${explicit_platforms && explicit_platforms.length > 0 ? 'explicit_input' : 'inferred_from_idea'} → ${detected.length} platform(s).`,
      );
      noteParts.push(
        `Serper: ${isSerperLive() ? 'live' : 'stub (no SERPER_API_KEY)'}; ${detected.length * 2} fan-out calls fired (${detected.length} platforms × 2 families: ToS + retros).`,
      );
      noteParts.push(
        `Source mix: ${independentCount} independent, ${conflictedCount} conflicted${unknownCount > 0 ? `, ${unknownCount} unknown→vendor-funded for math (spec §4 rule 4)` : ''}.`,
      );
      noteParts.push(
        `Single-platform dependency ratio: ${singleRatio.toFixed(2)} (rough proxy — 1.0 = all eggs in one basket).`,
      );
      noteParts.push(
        `Risk score ${baseScore.score}/5 base${adjusted.score !== baseScore.score ? `, ${adjusted.score}/5 after framing adjustment` : ''}.`,
      );
      noteParts.push(
        'No deplatforming stories are fabricated — empty retros[] means search returned no matches, not that the platform is safe.',
      );

      const result: ToolResult<AssessPlatformDependencyData> = {
        data: {
          detected_platforms: detected,
          tos_history_signals: tosSignals.slice(0, 20),
          deplatforming_retros: retros.slice(0, 20),
          single_platform_dependency_ratio: singleRatio,
          gate3_platform_risk_score: adjusted.score,
          gate3_platform_risk_label: adjusted.label,
          verdict,
        },
        sources,
        confidence_note: noteParts.join(' '),
        fallbacks_used: fallbacksUsed,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
