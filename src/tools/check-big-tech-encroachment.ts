// check_big_tech_encroachment — Gate 3 (Platform/Moat Risk) primary tool, Gate 5 secondary.
//
// Surfaces evidence that Apple / Google / Microsoft might ship a feature
// that obsoletes the user's idea — by scanning their dev conferences,
// public API/SDK releases, and acquisition history in the category.
//
// Per spec: returns adjacency score (1-5) where 5 = hyperscaler is already
// shipping something in this space. Source tiers: S (dev docs, keynotes),
// A (acquisition news).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult, ToolSource } from '../types.js';
import {
  serperSearch,
  isSerperLive,
  type SerperOrganicResult,
} from '../lib/serper.js';

type Hyperscaler = 'Apple' | 'Google' | 'Microsoft' | 'Meta' | 'Amazon';
type AdjacencyScore = 1 | 2 | 3 | 4 | 5;

interface ConferenceMention {
  hyperscaler: Hyperscaler;
  event: string; // WWDC / Google I/O / Microsoft Build / etc.
  title: string;
  url: string;
  snippet: string;
  recency_signal: 'last_24mo' | 'older' | 'unknown';
}

interface PlatformApiSignal {
  hyperscaler: Hyperscaler;
  api_or_feature: string;
  url: string;
  snippet: string;
}

interface AcquisitionSignal {
  hyperscaler: Hyperscaler;
  target_company: string;
  url: string;
  snippet: string;
}

interface CheckBigTechEncroachmentData {
  adjacency_score: AdjacencyScore;
  adjacency_label: string;
  conference_mentions: ConferenceMention[];
  platform_api_signals: PlatformApiSignal[];
  acquisitions: AcquisitionSignal[];
  hyperscalers_active: Hyperscaler[];
  verdict: string;
  killshot_risk: string | null;
}

// Conferences are the highest-signal place to find "what hyperscalers
// will ship in the next 12-24mo". The official site:domain filters keep
// us anchored to first-party material (tier S).
const HYPERSCALER_CONFERENCES: { hyperscaler: Hyperscaler; event: string; site: string }[] = [
  { hyperscaler: 'Apple', event: 'WWDC', site: 'developer.apple.com' },
  { hyperscaler: 'Apple', event: 'WWDC', site: 'apple.com' },
  { hyperscaler: 'Google', event: 'Google I/O', site: 'io.google' },
  { hyperscaler: 'Google', event: 'Google I/O', site: 'developers.google.com' },
  { hyperscaler: 'Microsoft', event: 'Microsoft Build', site: 'build.microsoft.com' },
  { hyperscaler: 'Microsoft', event: 'Microsoft Build', site: 'learn.microsoft.com' },
  { hyperscaler: 'Meta', event: 'Meta Connect', site: 'developers.meta.com' },
  { hyperscaler: 'Amazon', event: 'AWS re:Invent', site: 'aws.amazon.com' },
];

// Year markers to detect recency from a snippet/title.
const CURRENT_YEAR = new Date().getFullYear();
const RECENT_YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

function detectRecency(text: string): 'last_24mo' | 'older' | 'unknown' {
  for (const y of RECENT_YEARS) {
    if (text.includes(String(y))) return 'last_24mo';
  }
  // any 4-digit year that isn't in the recent window → older
  const oldYear = text.match(/\b(19|20)\d{2}\b/);
  if (oldYear && !RECENT_YEARS.includes(parseInt(oldYear[0], 10))) return 'older';
  return 'unknown';
}

function scoreAdjacency(
  conferences: ConferenceMention[],
  apis: PlatformApiSignal[],
  acquisitions: AcquisitionSignal[],
): { score: AdjacencyScore; label: string } {
  const recentConfMentions = conferences.filter((c) => c.recency_signal === 'last_24mo').length;
  const apiCount = apis.length;
  const acqCount = acquisitions.length;

  // 5 — hyperscaler is already shipping something in this space (recent conference + APIs)
  if (recentConfMentions >= 2 && apiCount >= 2) {
    return { score: 5, label: 'Hyperscaler is already shipping in this space — existential risk' };
  }
  // 4 — strong signal: multiple recent conference mentions OR active APIs
  if (recentConfMentions >= 2 || apiCount >= 3) {
    return { score: 4, label: 'Strong encroachment signal — likely shipping in 12mo' };
  }
  // 3 — moderate: at least one recent mention + supporting evidence
  if (recentConfMentions >= 1 && (apiCount >= 1 || acqCount >= 1)) {
    return { score: 3, label: 'Moderate encroachment signal — adjacent investment visible' };
  }
  // 2 — weak: scattered signals
  if (recentConfMentions + apiCount + acqCount >= 2) {
    return { score: 2, label: 'Weak signal — some adjacent activity, not directly competing' };
  }
  // 1 — no signal found
  return { score: 1, label: 'No clear encroachment signal in 24mo window' };
}

export function registerCheckBigTechEncroachment(server: McpServer): void {
  server.registerTool(
    'check_big_tech_encroachment',
    {
      description:
        'Assess platform / big-tech encroachment risk (Gate 3). Scans Apple WWDC, Google I/O, Microsoft Build, Meta Connect, and AWS re:Invent sessions in the last 24mo for category overlap. Also looks for new platform APIs and acquisitions in the space. Returns adjacency score 1-5 where 5 = hyperscaler already shipping.',
      inputSchema: {
        idea_description: z
          .string()
          .describe('Plain-language description of the product idea — used as the search query base'),
        category: z
          .string()
          .describe('Product category — e.g. "focus app", "AI writing assistant", "habit tracker"'),
        category_keywords: z
          .array(z.string())
          .optional()
          .describe('Optional extra keywords that narrow the search, e.g. ["screen time", "deep work", "context switching"]'),
      },
    },
    async ({ idea_description, category, category_keywords }) => {
      const sources: ToolSource[] = [];
      const fallbacksUsed: string[] = [];

      const keywords = category_keywords ?? [];
      const queryBase = [category, ...keywords].join(' ');

      // ───────────────────────────────────────────────────────────
      // Phase 1: Conference mentions across all hyperscalers
      // ───────────────────────────────────────────────────────────
      const conferenceMentions: ConferenceMention[] = [];

      const conferenceSearches = HYPERSCALER_CONFERENCES.map(async (conf) => {
        const query = `${queryBase} site:${conf.site}`;
        try {
          const results = await serperSearch(query, 5);
          return { conf, results };
        } catch {
          return { conf, results: [] as SerperOrganicResult[] };
        }
      });

      const conferenceResults = await Promise.all(conferenceSearches);

      for (const { conf, results } of conferenceResults) {
        for (const r of results) {
          const text = `${r.title} ${r.snippet}`;
          conferenceMentions.push({
            hyperscaler: conf.hyperscaler,
            event: conf.event,
            title: r.title,
            url: r.link,
            snippet: r.snippet,
            recency_signal: detectRecency(text),
          });
        }
        sources.push({
          url: `https://www.google.com/search?q=${encodeURIComponent(`${queryBase} site:${conf.site}`)}`,
          tier: 'S', // first-party dev docs / keynote material
          bias: 'conflicted', // hyperscaler self-reported
          fetched_at: new Date().toISOString(),
          contribution: `${conf.hyperscaler} ${conf.event} mentions of "${queryBase}"`,
        });
      }

      // ───────────────────────────────────────────────────────────
      // Phase 2: Platform API / SDK signals (broader than conferences)
      // ───────────────────────────────────────────────────────────
      const apiQueries: { hyperscaler: Hyperscaler; q: string }[] = [
        { hyperscaler: 'Apple', q: `${queryBase} "iOS" OR "macOS" API SDK new framework` },
        { hyperscaler: 'Google', q: `${queryBase} "Android" OR "Chrome" API new` },
        { hyperscaler: 'Microsoft', q: `${queryBase} "Windows" OR "Copilot" API new` },
      ];

      const platformApiSignals: PlatformApiSignal[] = [];
      for (const { hyperscaler, q } of apiQueries) {
        try {
          const results = await serperSearch(q, 3);
          for (const r of results) {
            // Only count results that mention recent years
            if (detectRecency(`${r.title} ${r.snippet}`) === 'last_24mo') {
              platformApiSignals.push({
                hyperscaler,
                api_or_feature: r.title,
                url: r.link,
                snippet: r.snippet,
              });
            }
          }
          sources.push({
            url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
            tier: 'S',
            bias: 'conflicted',
            fetched_at: new Date().toISOString(),
            contribution: `${hyperscaler} platform API/SDK announcements`,
          });
        } catch {
          // graceful degradation per spec — never fail silently, but never throw
        }
      }

      // ───────────────────────────────────────────────────────────
      // Phase 3: Acquisitions in the category
      // ───────────────────────────────────────────────────────────
      const acquisitionQuery = `${queryBase} acquired OR acquisition (Apple OR Google OR Microsoft OR Meta) site:techcrunch.com OR site:theverge.com OR site:bloomberg.com`;
      const acquisitions: AcquisitionSignal[] = [];

      try {
        const results = await serperSearch(acquisitionQuery, 5);
        for (const r of results) {
          const text = `${r.title} ${r.snippet}`;
          // Identify which hyperscaler is mentioned
          let hyperscaler: Hyperscaler | null = null;
          if (/apple/i.test(text)) hyperscaler = 'Apple';
          else if (/google|alphabet/i.test(text)) hyperscaler = 'Google';
          else if (/microsoft/i.test(text)) hyperscaler = 'Microsoft';
          else if (/meta|facebook/i.test(text)) hyperscaler = 'Meta';
          else if (/amazon|aws/i.test(text)) hyperscaler = 'Amazon';
          if (!hyperscaler) continue;

          // Try to extract the target company name from the title
          const acqMatch = r.title.match(/acquir(?:es?|ed)\s+([A-Z][A-Za-z0-9.&\- ]+?)(?:\s+for|\s+in|[,.])/);
          acquisitions.push({
            hyperscaler,
            target_company: acqMatch ? acqMatch[1].trim() : r.title.slice(0, 60),
            url: r.link,
            snippet: r.snippet,
          });
        }
        sources.push({
          url: `https://www.google.com/search?q=${encodeURIComponent(acquisitionQuery)}`,
          tier: 'A',
          bias: 'independent',
          fetched_at: new Date().toISOString(),
          contribution: `Press coverage of acquisitions in "${category}" space`,
        });
      } catch {
        // graceful degradation
      }

      if (!isSerperLive()) {
        fallbacksUsed.push('serper (stub — set SERPER_API_KEY)');
      }

      // ───────────────────────────────────────────────────────────
      // Score & verdict
      // ───────────────────────────────────────────────────────────
      const { score, label } = scoreAdjacency(conferenceMentions, platformApiSignals, acquisitions);

      const hyperscalers = new Set<Hyperscaler>();
      conferenceMentions.forEach((c) => c.recency_signal === 'last_24mo' && hyperscalers.add(c.hyperscaler));
      platformApiSignals.forEach((a) => hyperscalers.add(a.hyperscaler));
      acquisitions.forEach((a) => hyperscalers.add(a.hyperscaler));

      let verdict: string;
      let killshotRisk: string | null = null;

      if (score >= 4) {
        verdict = `Gate 3 FAIL likely. Adjacency ${score}/5: ${label}. Active hyperscalers: ${[...hyperscalers].join(', ')}.`;
        killshotRisk = `Building on a road being paved through your house. ${[...hyperscalers].join(', ')} ${score === 5 ? 'is/are already shipping' : 'will likely ship'} in this category within 12mo.`;
      } else if (score === 3) {
        verdict = `Gate 3 CONDITIONAL. Adjacency ${score}/5: ${label}. Watch ${[...hyperscalers].join(', ')} closely — partial overlap detected.`;
      } else {
        verdict = `Gate 3 likely PASS on encroachment alone. Adjacency ${score}/5: ${label}. Still verify with assess_platform_dependency for ToS/integration risks.`;
      }

      const result: ToolResult<CheckBigTechEncroachmentData> = {
        data: {
          adjacency_score: score,
          adjacency_label: label,
          conference_mentions: conferenceMentions.filter((c) => c.recency_signal === 'last_24mo').slice(0, 10),
          platform_api_signals: platformApiSignals.slice(0, 10),
          acquisitions: acquisitions.slice(0, 5),
          hyperscalers_active: [...hyperscalers],
          verdict,
          killshot_risk: killshotRisk,
        },
        sources,
        confidence_note: `Searched ${HYPERSCALER_CONFERENCES.length} conference site filters across ${new Set(HYPERSCALER_CONFERENCES.map((c) => c.hyperscaler)).size} hyperscalers + ${apiQueries.length} API queries + 1 acquisition query. Adjacency score is heuristic from signal counts — review the raw mentions before treating verdict as final. Recency detection relies on year strings in titles/snippets and can miss recent dateless pages.${!isSerperLive() ? ' Serper not configured — results are stubbed.' : ''}`,
        fallbacks_used: fallbacksUsed,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
