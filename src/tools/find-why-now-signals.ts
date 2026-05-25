// find_why_now_signals — Gate 5 (Why Now) primary tool.
//
// Surfaces evidence that *now* is the right moment to build this idea:
//   1. Recent platform/API enablers (last 24mo) — hyperscaler dev docs + regulatory shifts.
//   2. YC RFS touchpoints — does YC's current Request for Startups mention this category?
//   3. Macro demand / launch-cluster signals — Serper-aggregated launch mentions on TC/Verge/PH.
//
// Per spec §7 entry + §3 Gate 5 definition + §4 source tier + bias rules.
// Notably: YC RFS is tier A / bias `conflicted` per spec §4 rule 6 (positioning signal).
// Hyperscaler dev docs are tier S / bias `conflicted` (first-party);
// regulatory bodies are tier A / bias `independent`;
// press coverage is tier A / bias `independent`;
// Serper SERP aggregation is tier B / bias `independent`.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult, ToolSource } from '../types.js';
import {
  serperSearch,
  isSerperLive,
  type SerperOrganicResult,
} from '../lib/serper.js';
import { effectiveBias, requiresUpgradeFromUnknown } from '../lib/bias.js';
import { detectRecency, CURRENT_YEAR } from '../lib/recency.js';

type EnablerType =
  | 'api'
  | 'model_capability'
  | 'regulatory'
  | 'platform_change'
  | 'launch_cluster';

type SignalStrength = 'strong' | 'moderate' | 'weak' | 'none';

interface RecentEnabler {
  title: string;
  url: string;
  type: EnablerType;
  recency_signal: 'last_24mo' | 'older' | 'unknown';
  snippet: string;
  hyperscaler_or_body: string;
}

interface RFSTouchpoint {
  rfs_vintage: string;
  category_name: string;
  alignment_reasoning: string;
  url: string;
}

interface LaunchClusterSignal {
  title: string;
  url: string;
  source_site: string;
  snippet: string;
  recency_signal: 'last_24mo' | 'older' | 'unknown';
}

interface FindWhyNowSignalsData {
  recent_enablers: RecentEnabler[];
  yc_rfs_touchpoints: RFSTouchpoint[];
  macro_demand_shifts: LaunchClusterSignal[];
  verdict: string;
  gate5_signal_strength: SignalStrength;
}

// ───────────────────────────────────────────────────────────────────────────
// Source-tier-aware site filters
// ───────────────────────────────────────────────────────────────────────────

// Hyperscaler dev-doc sites: tier S, bias `conflicted` (first-party).
const HYPERSCALER_DOC_SITES: { site: string; party: string }[] = [
  { site: 'developer.apple.com', party: 'Apple' },
  { site: 'developers.google.com', party: 'Google' },
  { site: 'learn.microsoft.com', party: 'Microsoft' },
  { site: 'developers.meta.com', party: 'Meta' },
  { site: 'platform.openai.com', party: 'OpenAI' },
  { site: 'docs.anthropic.com', party: 'Anthropic' },
];

// Regulatory bodies: tier A, bias `independent`.
const REGULATORY_SITES: { site: string; body: string }[] = [
  { site: 'ec.europa.eu', body: 'European Commission' },
  { site: 'ftc.gov', body: 'US FTC' },
  { site: 'gov.uk', body: 'UK Government' },
];

// Press / launch sites: tier A, bias `independent`.
const PRESS_SITES = ['techcrunch.com', 'theverge.com', 'producthunt.com'];

// ───────────────────────────────────────────────────────────────────────────
// YC RFS — duplicated category list from find-yc-rfs-alignment to avoid
// tool-to-tool dependency. Per spec §4 rule 6, YC RFS = tier A / `conflicted`
// because YC has a stake in funding startups in these categories.
// ───────────────────────────────────────────────────────────────────────────

const YC_RFS_VINTAGE = 'YC Summer 2026';
const YC_RFS_URL = 'https://www.ycombinator.com/rfs';

const YC_S26_CATEGORIES = [
  {
    name: 'Company Brain',
    keywords: [
      /company (brain|memory|os|operating system)/i,
      /institutional knowledge/i,
      /cross.?functional/i,
      /internal (tool|workflow|automation)/i,
      /enterprise (ai|automation|intelligence)/i,
    ],
  },
  {
    name: 'Software for Agents',
    keywords: [
      /agent (platform|infra|infrastructure|orchestrat|tool|memory|deploy)/i,
      /autonomous (ai|agent|system)/i,
      /llm (tool|orchestrat|agent)/i,
      /agentic/i,
      /multi.?agent/i,
    ],
  },
  {
    name: 'AI-Native Service Companies',
    keywords: [
      /ai.?native service/i,
      /ai (law|legal|accounting|hr|consult|design|audit|tax)/i,
      /replace (human|worker|team)/i,
      /10x cheaper|100x cheaper/i,
      /fractional (cfo|cto|coo|legal|hr)/i,
    ],
  },
  {
    name: 'Dynamic Software Interfaces',
    keywords: [
      /dynamic (ui|interface|frontend)/i,
      /ai.?generated (ui|interface|layout)/i,
      /adaptive (ui|interface)/i,
      /no.?code.*ai|ai.*no.?code/i,
      /context.?aware interface/i,
    ],
  },
  {
    name: 'SaaS Challengers',
    keywords: [
      /saas (challenger|replacement|alternative|rebuild)/i,
      /replace (salesforce|hubspot|zendesk|jira|notion|slack|asana)/i,
      /ai.?native (crm|erp|hris|ats|project management|helpdesk)/i,
      /vertical saas/i,
    ],
  },
  {
    name: 'AI Operating System for Companies',
    keywords: [
      /ai (os|operating system) for (companies|enterprise|business)/i,
      /unified (platform|layer|system) for (ai|enterprise|company)/i,
      /company (os|operating system)/i,
      /enterprise (platform|ai platform)/i,
      /single pane (of glass)?/i,
    ],
  },
];

// Recency classification (detectRecency, CURRENT_YEAR, RECENT_YEARS) is shared
// with check_big_tech_encroachment via lib/recency.ts.

// ───────────────────────────────────────────────────────────────────────────
// YC RFS touchpoint scan (in-process, no tool-to-tool call)
// ───────────────────────────────────────────────────────────────────────────

function scanYCRFSTouchpoints(
  ideaDescription: string,
  category: string,
  keywords: string[],
): RFSTouchpoint[] {
  const haystack = [ideaDescription, category, ...keywords].join(' ').toLowerCase();
  const touchpoints: RFSTouchpoint[] = [];
  for (const cat of YC_S26_CATEGORIES) {
    const matched: string[] = [];
    for (const kw of cat.keywords) {
      if (kw.test(haystack)) matched.push(kw.source);
    }
    if (matched.length > 0) {
      touchpoints.push({
        rfs_vintage: YC_RFS_VINTAGE,
        category_name: cat.name,
        alignment_reasoning: `Matched ${matched.length}/${cat.keywords.length} keyword patterns: ${matched.slice(0, 3).join(', ')}`,
        url: YC_RFS_URL,
      });
    }
  }
  return touchpoints;
}

// ───────────────────────────────────────────────────────────────────────────
// Signal-strength scoring heuristic
// ───────────────────────────────────────────────────────────────────────────

function scoreSignalStrength(
  enablers: RecentEnabler[],
  rfsTouchpoints: RFSTouchpoint[],
  launches: LaunchClusterSignal[],
): SignalStrength {
  const recentEnablers = enablers.filter((e) => e.recency_signal === 'last_24mo');
  const recentLaunches = launches.filter((l) => l.recency_signal === 'last_24mo');
  const distinctEnablers = new Set(recentEnablers.map((e) => e.url)).size;
  const hasRFS = rfsTouchpoints.length > 0;
  const hasLaunchCluster = recentLaunches.length >= 2;

  if (distinctEnablers >= 3 && hasRFS && hasLaunchCluster) return 'strong';
  if (distinctEnablers >= 1 && (hasRFS || hasLaunchCluster)) return 'moderate';
  if (recentEnablers.length > 0 || hasRFS || recentLaunches.length > 0) return 'weak';
  return 'none';
}

// ───────────────────────────────────────────────────────────────────────────
// Tool registration
// ───────────────────────────────────────────────────────────────────────────

export function registerFindWhyNowSignals(server: McpServer): void {
  server.registerTool(
    'find_why_now_signals',
    {
      description:
        'Assess Gate 5 (Why Now) — surfaces recent platform/API enablers (last 24mo), YC RFS touchpoints, and launch-cluster signals for the category. Returns gate5_signal_strength (strong/moderate/weak/none) plus a verdict tying signals to Gate 5.',
      inputSchema: {
        idea_description: z
          .string()
          .describe('Plain-language description of the product idea — used as a search-query base'),
        category: z
          .string()
          .describe('Product category — e.g. "focus app", "AI writing assistant", "habit tracker"'),
        category_keywords: z
          .array(z.string())
          .optional()
          .describe('Optional extra keywords to narrow the search, e.g. ["screen time", "deep work"]'),
      },
    },
    async ({ idea_description, category, category_keywords }) => {
      const sources: ToolSource[] = [];
      const fallbacksUsed: string[] = [];
      const keywords = category_keywords ?? [];
      const queryBase = [category, ...keywords].join(' ');

      // ─────────────────────────────────────────────────────────
      // Phase 1: Recent platform/API enablers — hyperscaler dev docs
      //   Tier S, bias `conflicted` (first-party material).
      // ─────────────────────────────────────────────────────────
      const recentEnablers: RecentEnabler[] = [];

      const hyperscalerSearches = HYPERSCALER_DOC_SITES.map(async ({ site, party }) => {
        const query = `${queryBase} ${CURRENT_YEAR} OR ${CURRENT_YEAR - 1} site:${site}`;
        try {
          const results = await serperSearch(query, 3);
          return { site, party, query, results };
        } catch {
          return { site, party, query, results: [] as SerperOrganicResult[] };
        }
      });

      const regulatorySearches = REGULATORY_SITES.map(async ({ site, body }) => {
        const query = `${category} regulation ${CURRENT_YEAR} OR ${CURRENT_YEAR - 1} site:${site}`;
        try {
          const results = await serperSearch(query, 2);
          return { site, body, query, results };
        } catch {
          return { site, body, query, results: [] as SerperOrganicResult[] };
        }
      });

      const [hyperscalerResults, regulatoryResults] = await Promise.all([
        Promise.allSettled(hyperscalerSearches),
        Promise.allSettled(regulatorySearches),
      ]);

      for (const settled of hyperscalerResults) {
        if (settled.status !== 'fulfilled') continue;
        const { site, party, query, results } = settled.value;
        for (const r of results) {
          const text = `${r.title} ${r.snippet}`;
          // Heuristic enabler type: API/SDK mention → 'api'; model capability → 'model_capability'.
          let type: EnablerType = 'platform_change';
          if (/api|sdk|framework|endpoint/i.test(text)) type = 'api';
          else if (/model|capability|gpt|claude|gemini|llm/i.test(text)) type = 'model_capability';
          recentEnablers.push({
            title: r.title,
            url: r.link,
            type,
            recency_signal: detectRecency(text),
            snippet: r.snippet,
            hyperscaler_or_body: party,
          });
        }
        sources.push({
          url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          tier: 'S',
          bias: 'conflicted', // hyperscaler dev docs are first-party
          fetched_at: new Date().toISOString(),
          contribution: `${party} dev-doc / API release mentions for "${queryBase}" (${CURRENT_YEAR - 1}–${CURRENT_YEAR})`,
        });
      }

      for (const settled of regulatoryResults) {
        if (settled.status !== 'fulfilled') continue;
        const { site, body, query, results } = settled.value;
        for (const r of results) {
          const text = `${r.title} ${r.snippet}`;
          recentEnablers.push({
            title: r.title,
            url: r.link,
            type: 'regulatory',
            recency_signal: detectRecency(text),
            snippet: r.snippet,
            hyperscaler_or_body: body,
          });
        }
        sources.push({
          url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          tier: 'A',
          bias: 'independent', // regulatory body publications are independent
          fetched_at: new Date().toISOString(),
          contribution: `${body} regulatory mentions for "${category}" (${CURRENT_YEAR - 1}–${CURRENT_YEAR})`,
        });
      }

      // ─────────────────────────────────────────────────────────
      // Phase 2: YC RFS touchpoints — in-process keyword scan.
      //   Tier A, bias `conflicted` per spec §4 rule 6 (positioning signal).
      // ─────────────────────────────────────────────────────────
      const ycTouchpoints = scanYCRFSTouchpoints(idea_description, category, keywords);
      if (ycTouchpoints.length > 0) {
        sources.push({
          url: YC_RFS_URL,
          tier: 'A',
          // YC RFS reflects YC's strategic priorities — conflicted per spec §4
          // rule 6 (positioning material from a stakeholder). YC has a stake in
          // funding the categories they publish.
          bias: 'conflicted',
          fetched_at: new Date().toISOString(),
          contribution: `${YC_RFS_VINTAGE} Request for Startups — positioning signal (YC's strategic priorities), not endorsement.`,
        });
      }

      // ─────────────────────────────────────────────────────────
      // Phase 3: Launch cluster — Serper-aggregated launch mentions
      //   from TC / Verge / ProductHunt for the last 24mo.
      //   Tier B, bias `independent` (third-party aggregator surface).
      // ─────────────────────────────────────────────────────────
      const launchCluster: LaunchClusterSignal[] = [];
      const launchQuery = `${queryBase} launched ${CURRENT_YEAR} OR ${CURRENT_YEAR - 1} ${PRESS_SITES.map((s) => `site:${s}`).join(' OR ')}`;
      try {
        const launchResults = await serperSearch(launchQuery, 6);
        for (const r of launchResults) {
          const text = `${r.title} ${r.snippet}`;
          // Detect which press site the result came from.
          let sourceSite = 'other';
          for (const s of PRESS_SITES) {
            if (r.link.includes(s)) {
              sourceSite = s;
              break;
            }
          }
          launchCluster.push({
            title: r.title,
            url: r.link,
            source_site: sourceSite,
            snippet: r.snippet,
            recency_signal: detectRecency(text),
          });
        }
        sources.push({
          url: `https://www.google.com/search?q=${encodeURIComponent(launchQuery)}`,
          tier: 'B',
          bias: 'independent',
          fetched_at: new Date().toISOString(),
          contribution: `Launch-cluster aggregation across TC/Verge/ProductHunt for "${queryBase}"`,
        });
      } catch {
        // graceful degradation — never throw out of the tool
      }

      if (!isSerperLive()) {
        fallbacksUsed.push('serper (stub — set SERPER_API_KEY)');
      }

      // ─────────────────────────────────────────────────────────
      // Scoring + verdict
      // ─────────────────────────────────────────────────────────
      const gate5SignalStrength = scoreSignalStrength(
        recentEnablers,
        ycTouchpoints,
        launchCluster,
      );

      const recentEnablerCount = recentEnablers.filter((e) => e.recency_signal === 'last_24mo').length;
      const recentLaunchCount = launchCluster.filter((l) => l.recency_signal === 'last_24mo').length;

      let verdict: string;
      switch (gate5SignalStrength) {
        case 'strong':
          verdict = `Gate 5 PASS likely. Strong Why-Now signal: ${recentEnablerCount} recent enablers across hyperscalers/regulators, ${ycTouchpoints.length} YC RFS touchpoint(s), ${recentLaunchCount} recent launches in category. Multiple converging shifts make now materially different from 24mo ago.`;
          break;
        case 'moderate':
          verdict = `Gate 5 CONDITIONAL. Moderate Why-Now signal: ${recentEnablerCount} recent enabler(s) plus ${ycTouchpoints.length > 0 ? 'YC RFS alignment' : 'launch cluster'}. Real movement, but not a clear inflection — verify the enabler list materially unlocks this idea.`;
          break;
        case 'weak':
          verdict = `Gate 5 WEAK. Scattered signals (${recentEnablerCount} enabler(s), ${ycTouchpoints.length} RFS touchpoint(s), ${recentLaunchCount} launch(es)) but no anchor. Why-Now thesis must come from elsewhere or be made explicit by the builder.`;
          break;
        default:
          verdict = `Gate 5 FAIL likely. No recent enablers, no YC RFS touchpoints, no launch cluster in the 24mo window. Either the category is dormant or the search terms missed the relevant shifts — broaden category_keywords and retry before concluding.`;
      }

      // ─────────────────────────────────────────────────────────
      // confidence_note — honest accounting of sources + fallbacks.
      // Uses effectiveBias() for bias-mix transparency per spec §4 rule 4.
      // ─────────────────────────────────────────────────────────
      const unknownCount = requiresUpgradeFromUnknown(sources);
      const conflictedCount = sources.filter(
        (s) => effectiveBias(s.bias) === 'conflicted',
      ).length;
      const independentCount = sources.filter(
        (s) => effectiveBias(s.bias) === 'independent',
      ).length;

      const confidenceParts: string[] = [];
      confidenceParts.push(
        `Searched ${HYPERSCALER_DOC_SITES.length} hyperscaler dev-doc filters + ${REGULATORY_SITES.length} regulatory filters + 1 launch-cluster query.`,
      );
      confidenceParts.push(
        `Source mix: ${independentCount} independent, ${conflictedCount} conflicted (hyperscaler/YC self-publications)${unknownCount > 0 ? `, ${unknownCount} unknown→vendor-funded for math (spec §4 rule 4)` : ''}.`,
      );
      confidenceParts.push(
        'Recency detection relies on year-string scan of titles/snippets — dateless pages may misclassify as "unknown".',
      );
      if (!isSerperLive()) {
        confidenceParts.push('Serper not configured — results are stubbed; treat verdict as illustrative only.');
      }

      const result: ToolResult<FindWhyNowSignalsData> = {
        data: {
          recent_enablers: recentEnablers.slice(0, 12),
          yc_rfs_touchpoints: ycTouchpoints,
          macro_demand_shifts: launchCluster.slice(0, 8),
          verdict,
          gate5_signal_strength: gate5SignalStrength,
        },
        sources,
        confidence_note: confidenceParts.join(' '),
        fallbacks_used: fallbacksUsed,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
