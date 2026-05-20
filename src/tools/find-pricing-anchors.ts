import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult, ToolSource } from '../types.js';
import { fetchPage, stripHtml } from '../lib/webfetch.js';
import { serperSearch, serperSource, serperConfidenceNote, isSerperLive } from '../lib/serper.js';
import { waybackLookup, waybackSource, waybackConfidenceNote } from '../lib/wayback.js';
import { effectiveBias } from '../lib/bias.js';

type PricingModel = 'subscription' | 'one-time' | 'freemium' | 'usage-based' | 'unknown';

interface CurrentPricing {
  competitor: string;
  model: PricingModel;
  price: string;
  tiers: string[];
}

interface PricingHistory {
  competitor: string;
  trend: string;
}

interface FindPricingAnchorsData {
  current_pricing: CurrentPricing[];
  pricing_history: PricingHistory[];
  category_pricing_pattern: string;
  freemium_distribution: string;
  churn_signals: string[];
  auto_flags: string[];
}

const PRICING_URL_PATHS = ['/pricing', '/plans', '/price', '/pricing-plans'];

function guessPricingUrl(competitor: string): string {
  const slug = competitor
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9-]/g, '');
  const base = competitor.startsWith('http') ? competitor : `https://${slug}.com`;
  return `${base.replace(/\/$/, '')}/pricing`;
}

function extractDomain(competitor: string): string {
  if (competitor.startsWith('http')) {
    try {
      return new URL(competitor).hostname.replace(/^www\./, '');
    } catch {
      return competitor;
    }
  }
  const slug = competitor.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9-.]/g, '');
  return `${slug}.com`;
}

function detectPricingModel(text: string): PricingModel {
  const lower = text.toLowerCase();
  if (/free.?forever|free plan|freemium|free tier|starts free/i.test(lower)) return 'freemium';
  if (/per (request|token|call|api|usage|message)|pay.?as.?you.?go|metered/i.test(lower))
    return 'usage-based';
  if (/one.?time|lifetime|pay once|buy once/i.test(lower)) return 'one-time';
  if (/\/mo|\/month|\/year|\/yr|per month|per year|annual|monthly|subscription/i.test(lower))
    return 'subscription';
  return 'unknown';
}

function extractPriceTiers(text: string): string[] {
  const tiers: string[] = [];
  // Match patterns like "$29/mo", "$99/month", "$199/year", "€49/mo", "Free"
  const priceMatches = text.matchAll(
    /(?:free|[\$€£¥]?\s*\d+(?:[.,]\d+)?(?:\s*\/\s*(?:mo(?:nth)?|yr|year|user|seat|month))?)/gi
  );
  for (const match of priceMatches) {
    const val = match[0].trim();
    if (val.length > 0 && !tiers.includes(val) && tiers.length < 6) {
      tiers.push(val);
    }
  }
  return tiers;
}

function extractChurnLanguage(text: string): string[] {
  const signals: string[] = [];
  const patterns = [
    /cancell?(?:ed|ing|ation)\s+(?:my|the|our|subscription|plan|account)?[^.]*\./gi,
    /(?:not worth|waste of money|too expensive|overpriced|switched (?:to|from)|looking for alternative)[^.]*\./gi,
    /refund[^.]*\./gi,
    /downgrad(?:ed|ing)[^.]*\./gi,
  ];
  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const m of matches) {
      const snippet = m[0].trim().slice(0, 150);
      if (!signals.includes(snippet)) signals.push(snippet);
      if (signals.length >= 5) break;
    }
    if (signals.length >= 5) break;
  }
  return signals;
}

export function registerFindPricingAnchors(server: McpServer): void {
  server.registerTool(
    'find_pricing_anchors',
    {
      description:
        'Fetch competitor pricing pages (live + Wayback), research pricing history, and scan G2/Capterra for churn signals. Returns current pricing models, historical trends, and auto-generated WTP flags.',
      inputSchema: {
        category: z.string().describe('Product category (e.g., "project management", "analytics dashboard")'),
        competitors: z
          .array(z.string())
          .describe('List of competitor names or URLs to fetch pricing for'),
        framing: z
          .object({
            audience: z.enum(['B2B', 'B2C', 'B2B2C', 'dev_tools']),
            builder: z.enum(['solo', 'small_team', 'funded']),
          })
          .optional()
          .describe('Optional framing for contextual interpretation'),
      },
    },
    async ({ category, competitors, framing }) => {
      const fallbacksUsed: string[] = [];
      const sources: ToolSource[] = [];
      const current_pricing: CurrentPricing[] = [];
      const pricing_history: PricingHistory[] = [];
      const all_churn_signals: string[] = [];
      let waybackAttempted = 0;
      let waybackFound = 0;

      if (!isSerperLive()) fallbacksUsed.push('serper (stub — set SERPER_API_KEY)');

      for (const competitor of competitors) {
        const domain = extractDomain(competitor);
        const pricingUrl = guessPricingUrl(competitor);
        let fetchedText = '';
        let fetchedSuccessfully = false;
        let liveFetchedUrl: string | null = null;

        // Step 1: Fetch live pricing page
        for (const path of [pricingUrl, ...PRICING_URL_PATHS.map((p) => `https://${domain}${p}`)]) {
          const result = await fetchPage(path);
          if (result.ok && result.text.length > 300) {
            fetchedText = stripHtml(result.text).slice(0, 5000);
            fetchedSuccessfully = true;
            liveFetchedUrl = path;
            sources.push({
              url: path,
              tier: 'S',
              bias: 'conflicted',
              fetched_at: new Date().toISOString(),
              contribution: `Live pricing page for ${competitor} — self-reported pricing, immutable at fetch time`,
            });
            break;
          }
        }

        // Step 2: Wayback Machine — verified snapshot ONLY (no fabrication; H8 fix).
        // Per spec §11 anti-pattern 2: we never record an S-tier source for a URL
        // we did not actually fetch. waybackLookup returns null on miss/failure.
        const lookupTarget = liveFetchedUrl ?? pricingUrl;
        waybackAttempted += 1;
        const snapshot = await waybackLookup(lookupTarget);
        let waybackSnapshotForHistory: { url: string; iso: string } | null = null;
        if (snapshot) {
          waybackFound += 1;
          const src = waybackSource(
            snapshot,
            `Wayback snapshot of ${competitor} pricing page captured ${snapshot.timestamp.slice(0, 8)} — historical anchor for price-change detection`
          );
          sources.push(src);
          waybackSnapshotForHistory = { url: src.url, iso: src.fetched_at };
        } else {
          fallbacksUsed.push(`wayback (no snapshots found for ${competitor})`);
        }

        // Step 3: Serper for pricing history
        const historyQuery = `${competitor} pricing history site:web.archive.org`;
        const historyResults = await serperSearch(historyQuery, 3);
        sources.push(serperSource(historyQuery));

        let trend = 'Unknown — insufficient historical data';
        if (waybackSnapshotForHistory) {
          trend = `Verified Wayback snapshot available (${waybackSnapshotForHistory.iso.slice(0, 10)}) — compare against live pricing to detect changes`;
        }
        if (historyResults.length > 0) {
          const snippets = historyResults.map((r) => r.snippet).join(' ');
          if (/pric.{0,20}(increas|higher|went up|raised)/i.test(snippets)) {
            trend = 'Prices appear to have increased over time — market strengthening signal';
          } else if (/pric.{0,20}(decreas|lower|went down|reduc|cut)/i.test(snippets)) {
            trend = 'Prices appear to have decreased over time — potential commoditization signal';
          } else if (historyResults.some((r) => r.link.includes('web.archive.org'))) {
            trend = 'Historical pricing snapshots found in Wayback Machine — manual comparison recommended';
          }
        }
        pricing_history.push({ competitor, trend });

        // Parse current pricing
        const pricingText = fetchedSuccessfully ? fetchedText : historyResults.map((r) => r.snippet).join(' ');
        const model = detectPricingModel(pricingText);
        const tiers = extractPriceTiers(pricingText);
        const priceStr = tiers.length > 0 ? tiers.join(' / ') : 'Not found — check manually';

        current_pricing.push({ competitor, model, price: priceStr, tiers });
      }

      // Step 4: G2/Capterra churn signals
      const reviewQuery = `${category} reviews "cancelled" OR "refund" OR "not worth" site:g2.com OR site:capterra.com`;
      const reviewResults = await serperSearch(reviewQuery, 5);
      sources.push({
        url: `https://www.g2.com/search?query=${encodeURIComponent(category)}`,
        tier: 'B',
        bias: 'independent',
        fetched_at: new Date().toISOString(),
        contribution: `G2/Capterra review aggregation for ${category} — churn and cancellation language`,
      });

      for (const r of reviewResults) {
        const signals = extractChurnLanguage(r.snippet);
        all_churn_signals.push(...signals);
      }
      // Deduplicate churn signals
      const churn_signals = [...new Set(all_churn_signals)].slice(0, 8);

      // Build category pricing pattern
      const models = current_pricing.map((p) => p.model);
      const freemiumCount = models.filter((m) => m === 'freemium').length;
      const subscriptionCount = models.filter((m) => m === 'subscription').length;
      const usageCount = models.filter((m) => m === 'usage-based').length;
      const oneTimeCount = models.filter((m) => m === 'one-time').length;
      const total = models.length || 1;

      const category_pricing_pattern =
        `Of ${total} competitor(s) analyzed: ` +
        [
          freemiumCount > 0 ? `${freemiumCount} freemium` : null,
          subscriptionCount > 0 ? `${subscriptionCount} subscription` : null,
          usageCount > 0 ? `${usageCount} usage-based` : null,
          oneTimeCount > 0 ? `${oneTimeCount} one-time` : null,
          models.filter((m) => m === 'unknown').length > 0
            ? `${models.filter((m) => m === 'unknown').length} unknown (pricing page not fetched)`
            : null,
        ]
          .filter(Boolean)
          .join(', ') + '.';

      const freemiumPct = Math.round((freemiumCount / total) * 100);
      const freemium_distribution =
        freemiumPct >= 80
          ? `${freemiumPct}% of competitors use freemium — dominant category pattern`
          : freemiumPct >= 50
          ? `${freemiumPct}% use freemium — mixed category, some paid tiers exist`
          : `${freemiumPct}% use freemium — primarily paid category`;

      // Auto-flags
      const auto_flags: string[] = [];

      // Price dropping flag
      const droppingCount = pricing_history.filter((h) =>
        h.trend.toLowerCase().includes('decreased') || h.trend.toLowerCase().includes('commoditization')
      ).length;
      if (droppingCount > 0) {
        auto_flags.push(
          `Price dropping in ${droppingCount} competitor(s) — weakening market signal for WTP`
        );
      }

      // All-free category flag
      if (freemiumPct === 100 && total >= 2) {
        auto_flags.push('All-free category — WTP concern: no paid comparable found. Validate willingness to pay before building.');
      }

      // High churn language flag
      if (churn_signals.length >= 3) {
        auto_flags.push(
          `High churn language in reviews (${churn_signals.length} signals) — category has a retention problem. Build in churn-prevention features from day one.`
        );
      }

      // Framing-specific flags
      if (framing) {
        if (framing.builder === 'solo' && freemiumPct >= 80) {
          auto_flags.push(
            'Solo framing + all-freemium category: highest WTP risk. Run 5 customer interviews specifically on price sensitivity before building.'
          );
        }
        if (framing.builder === 'funded' && subscriptionCount === 0 && total >= 3) {
          auto_flags.push(
            'Funded framing: no subscription comps found — institutional-scale revenue may be difficult in this category without a novel monetization model.'
          );
        }
        if (framing.audience === 'B2C' && all_churn_signals.length >= 2) {
          auto_flags.push(
            'B2C framing + churn signals: consumer WTP is especially fragile. Freemium + upgrade path must be extremely clear.'
          );
        }
      }

      const confidenceParts: string[] = [];
      const fetchedCount = current_pricing.filter((_p) =>
        sources.some(
          // Route through effectiveBias() per spec §4 rule 4: any `unknown`
          // source counts as `vendor-funded` for math (not `conflicted`), so
          // we don't accidentally inflate the live-fetched-pricing count.
          (s) => s.tier === 'S' && effectiveBias(s.bias) === 'conflicted' && s.contribution.includes('Live pricing')
        )
      ).length;
      confidenceParts.push(
        `Pricing pages: ${fetchedCount > 0 ? `${fetchedCount} fetched live (S/conflicted)` : 'none fetched live'}.`
      );
      confidenceParts.push(waybackConfidenceNote(waybackFound, waybackAttempted));
      confidenceParts.push(serperConfidenceNote());
      confidenceParts.push('G2/Capterra data via Serper snippets (B/independent).');

      const result: ToolResult<FindPricingAnchorsData> = {
        data: {
          current_pricing,
          pricing_history,
          category_pricing_pattern,
          freemium_distribution,
          churn_signals,
          auto_flags,
        },
        sources,
        confidence_note: confidenceParts.join(' '),
        fallbacks_used: fallbacksUsed,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
