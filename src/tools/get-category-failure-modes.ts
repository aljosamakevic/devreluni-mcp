import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult } from '../types.js';
import { okResult, honestGapResult } from '../lib/envelope.js';
import { serperSearch, serperSource, serperConfidenceNote, isSerperLive } from '../lib/serper.js';
import { searchReddit, redditSource, redditConfidenceNote, isRedditLive } from '../lib/reddit.js';
import { searchHN, hnSource } from '../lib/hn.js';

interface FailureMode {
  pattern: string;
  evidence: string[];
  products_affected: string[];
  is_structural: boolean;
}

interface GetCategoryFailureModesData {
  category: string;
  failure_modes: FailureMode[];
  structural_count: number;
  verdict: string;
}

const FAILURE_PATTERNS: Array<{ pattern: string; keywords: RegExp[] }> = [
  {
    pattern: 'CAC too high for market size',
    keywords: [/acqui(sition)? cost|cac|paid.?acquisition|too expensive to acquire/i],
  },
  {
    pattern: 'Free alternative from big tech',
    keywords: [/google|microsoft|apple|amazon|meta|free.?version|built.?in/i],
  },
  {
    pattern: 'Churn due to complexity',
    keywords: [/too.?complex|steep.?learning|onboard|setup|churn|cancel/i],
  },
  {
    pattern: 'Niche too small',
    keywords: [/niche|too.?small|limited.?market|not.?enough.?(users|customers)/i],
  },
  {
    pattern: 'Commoditization / race to zero',
    keywords: [/commodit|race.?to.?zero|free tier|pricing.?war|margin.?compres/i],
  },
  {
    pattern: 'Platform dependency killed product',
    keywords: [/platform.?(change|killed|shut|depric|api.?change)|app.?store|google.?play/i],
  },
  {
    pattern: 'Cannot monetize user base',
    keywords: [/monetiz|willingnes.?to.?pay|wtp|free.?forever|won.?t.?pay/i],
  },
  {
    pattern: 'Network effects lock users into incumbent',
    keywords: [/network.?effect|switching.?cost|lock.?in|ecosystem/i],
  },
  {
    pattern: 'Regulatory / compliance barrier',
    keywords: [/gdpr|hipaa|regulator|compliance|legal|enterprise.?procurement/i],
  },
];

function matchPatterns(text: string): string[] {
  return FAILURE_PATTERNS.filter((fp) => fp.keywords.some((kw) => kw.test(text))).map(
    (fp) => fp.pattern
  );
}

export function registerGetCategoryFailureModes(server: McpServer): void {
  server.registerTool(
    'get_category_failure_modes',
    {
      description:
        "Research historical failure modes in a product category by searching for post-mortems, shutdowns, and user complaints. Returns structural failure patterns relevant to the category. Envelope: { status: 'ok'|'honest_gap'|'error', data, sources, confidence_note, fallbacks_used, error? }. status='honest_gap' = ran cleanly, no substantive data found (evidence gap, not failure).",
      inputSchema: {
        category: z.string().describe('Product category to research (e.g., "project management", "B2B analytics")'),
        known_products: z
          .array(z.string())
          .optional()
          .describe('Optional list of known products in the category to focus the search'),
      },
    },
    async ({ category, known_products }) => {
      const fallbacksUsed: string[] = [];
      const allEvidence: Array<{ text: string; url?: string; source: string }> = [];

      const productContext = known_products?.length ? `${known_products.slice(0, 3).join(' OR ')} ` : '';
      const serperQuery = `${productContext}${category} startup failed OR shutdown OR "post-mortem" OR "cancelled"`;
      const redditQuery = `${category} "failed" OR "shutdown" OR "went under" OR "switched away"`;
      const hnQuery = `${category} failed startup post-mortem lessons`;

      // Serper
      const serperResults = await serperSearch(serperQuery, 8);
      if (!isSerperLive()) fallbacksUsed.push('serper (stub — set SERPER_API_KEY)');
      for (const r of serperResults) {
        allEvidence.push({ text: r.snippet, url: r.link, source: 'serper' });
      }

      // Reddit
      const redditResult = await searchReddit(redditQuery, 8);
      if (!isRedditLive()) fallbacksUsed.push('reddit (stub — set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET)');
      for (const post of redditResult.posts) {
        allEvidence.push({
          text: `${post.title} ${post.selftext}`.slice(0, 400),
          url: `https://reddit.com${post.permalink}`,
          source: 'reddit',
        });
      }

      // HN
      const hnHits = await searchHN(hnQuery, 8);
      for (const hit of hnHits) {
        const text = (hit.title ?? '') + ' ' + (hit.story_text ?? '');
        allEvidence.push({
          text: text.slice(0, 400),
          url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
          source: 'hn',
        });
      }

      // Build failure modes
      const modeMap: Record<string, FailureMode> = {};
      for (const ev of allEvidence) {
        const matched = matchPatterns(ev.text);
        for (const pattern of matched) {
          if (!modeMap[pattern]) {
            modeMap[pattern] = { pattern, evidence: [], products_affected: [], is_structural: false };
          }
          modeMap[pattern].evidence.push(ev.text.slice(0, 200));
          if (ev.url) {
            // Try to extract product name from URL
            try {
              const hostname = new URL(ev.url).hostname.replace(/^www\./, '');
              if (!modeMap[pattern].products_affected.includes(hostname)) {
                modeMap[pattern].products_affected.push(hostname);
              }
            } catch {
              // ignore invalid URLs
            }
          }
        }
      }

      // Mark structural (3+ independent sources)
      for (const mode of Object.values(modeMap)) {
        mode.is_structural = mode.evidence.length >= 3;
        // Cap evidence array
        mode.evidence = mode.evidence.slice(0, 5);
        mode.products_affected = mode.products_affected.slice(0, 5);
      }

      const failure_modes = Object.values(modeMap).sort(
        (a, b) => b.evidence.length - a.evidence.length
      );
      const structural_count = failure_modes.filter((m) => m.is_structural).length;

      let verdict: string;
      if (failure_modes.length === 0) {
        verdict = `No historical failure modes found for "${category}". This may indicate insufficient data or a genuinely novel category. Treat as an evidence gap, not validation.`;
      } else if (structural_count >= 3) {
        verdict = `High-risk category — ${structural_count} structural failure modes with 3+ evidence sources each: ${failure_modes.filter((m) => m.is_structural).map((m) => m.pattern).join('; ')}. Any new entrant must have explicit mitigation for each.`;
      } else if (structural_count >= 1) {
        verdict = `Medium-risk category — ${structural_count} structural failure mode(s): ${failure_modes.filter((m) => m.is_structural).map((m) => m.pattern).join('; ')}. Address these in your positioning.`;
      } else {
        verdict = `Low structural risk — ${failure_modes.length} failure patterns found but none confirmed by 3+ sources. Most are surface-level risks that can be mitigated with good execution.`;
      }

      // Phase 09: if the structural search returned no failure modes, this is
      // a successful run with an "evidence gap" finding — not a failure.
      // Models that read `status: 'honest_gap'` MUST log the gap and continue;
      // they MUST NOT invent infrastructure causes (no DB, no schema errors).
      const envelopeData = { category, failure_modes, structural_count, verdict };
      const envelopeSources = [
        serperSource(serperQuery),
        redditSource(redditQuery),
        hnSource(hnQuery),
      ];
      const envelopeNote = [
        serperConfidenceNote(),
        redditConfidenceNote(),
        'HN data is live.',
      ].join(' ');
      const result: ToolResult<GetCategoryFailureModesData> =
        failure_modes.length === 0
          ? honestGapResult(envelopeData, envelopeSources, envelopeNote, fallbacksUsed)
          : okResult(envelopeData, envelopeSources, envelopeNote, fallbacksUsed);

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
