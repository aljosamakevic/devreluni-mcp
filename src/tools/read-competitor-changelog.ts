import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult, ToolSource } from '../types.js';
import { okResult, honestGapResult } from '../lib/envelope.js';
import { fetchPage, stripHtml, guessChangelogUrls } from '../lib/webfetch.js';
import { serperSearch, isSerperLive } from '../lib/serper.js';

type FailureSignal =
  | 'setup_creep'
  | 'privacy_concern'
  | 'platform_gap'
  | 'churn_signal'
  | 'performance_issue'
  | 'scope_expansion'
  | 'pitch_vs_reality';

interface ChangelogEntry {
  version?: string;
  date?: string;
  summary: string;
  raw: string;
  failure_signals: FailureSignal[];
}

interface ReadCompetitorChangelogData {
  resolved_url: string;
  fetched: boolean;
  entries: ChangelogEntry[];
  failure_signals_found: FailureSignal[];
  interpretation: string;
}

const FAILURE_PATTERNS: Record<FailureSignal, RegExp[]> = {
  setup_creep: [
    /require[ds]? (setup|configuration|onboarding|manual)/i,
    /self.?host/i,
    /complex (install|setup)/i,
  ],
  privacy_concern: [
    /data (sharing|collection|retention|export)/i,
    /gdpr|ccpa|privacy/i,
    /telemetry/i,
  ],
  platform_gap: [
    /not (available|supported) on (mobile|ios|android|windows|linux)/i,
    /desktop.?only|mobile.?only/i,
    /api.?(limit|deprecat)/i,
  ],
  churn_signal: [
    /cancel|churn|refund|downgrade/i,
    /plan (eliminat|remov|discontinu)/i,
    /pricing (increas|chang)/i,
  ],
  performance_issue: [
    /slow|latency|timeout|lag|crash/i,
    /performance (improv|fix|degrad)/i,
  ],
  scope_expansion: [
    /new (product|platform|suite|hub)/i,
    /expand(ing)? (to|into)/i,
    /acqui/i,
  ],
  pitch_vs_reality: [
    /known issue|limitation|workaround|manual step|not yet/i,
    /coming soon|planned|roadmap/i,
  ],
};

function detectFailureSignals(text: string): FailureSignal[] {
  const found: FailureSignal[] = [];
  for (const [signal, patterns] of Object.entries(FAILURE_PATTERNS) as [FailureSignal, RegExp[]][]) {
    if (patterns.some((p) => p.test(text))) {
      found.push(signal);
    }
  }
  return found;
}

function parseChangelogEntries(text: string, url: string): ChangelogEntry[] {
  // Try to split by version headings or date headings
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const entries: ChangelogEntry[] = [];

  let currentEntry: Partial<ChangelogEntry> | null = null;
  const versionPattern = /^#{1,3}\s*(v?\d+\.\d+[\.\d]*|version \d+)/i;
  const datePattern = /\b(\d{4}[-/]\d{2}[-/]\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2},?\s+\d{4})\b/i;

  for (const line of lines) {
    const vMatch = line.match(versionPattern);
    const dMatch = line.match(datePattern);

    if (vMatch || (dMatch && line.length < 100)) {
      if (currentEntry && currentEntry.raw) {
        const raw = currentEntry.raw;
        entries.push({
          version: currentEntry.version,
          date: currentEntry.date,
          summary: raw.slice(0, 200),
          raw,
          failure_signals: detectFailureSignals(raw),
        });
      }
      currentEntry = {
        version: vMatch ? vMatch[1] : undefined,
        date: dMatch ? dMatch[0] : undefined,
        raw: line,
      };
    } else if (currentEntry) {
      currentEntry.raw = (currentEntry.raw ?? '') + '\n' + line;
    }
  }

  if (currentEntry && currentEntry.raw) {
    const raw = currentEntry.raw;
    entries.push({
      version: currentEntry.version,
      date: currentEntry.date,
      summary: raw.slice(0, 200),
      raw,
      failure_signals: detectFailureSignals(raw),
    });
  }

  // Fallback: if no structured entries found, create one big entry
  if (entries.length === 0 && text.length > 0) {
    const raw = text.slice(0, 3000);
    entries.push({
      summary: `Changelog content from ${url} (unstructured)`,
      raw,
      failure_signals: detectFailureSignals(raw),
    });
  }

  return entries.slice(0, 20); // cap at 20 entries
}

export function registerReadCompetitorChangelog(server: McpServer): void {
  server.registerTool(
    'read_competitor_changelog',
    {
      description:
        'Fetch and parse a competitor changelog, detecting failure signals like setup creep, churn language, and platform gaps. Falls back to search if no changelog URL is known.',
      inputSchema: {
        product: z
          .string()
          .describe('Competitor product name or URL (e.g., "notion.so" or "https://notion.so/releases")'),
      },
    },
    async ({ product }) => {
      const fallbacksUsed: string[] = [];
      const sources: ToolSource[] = [];
      let resolvedUrl = '';
      let fetched = false;
      let changelogText = '';

      // Determine base URL
      let baseUrl: string;
      if (product.startsWith('http')) {
        baseUrl = product;
      } else {
        // Guess domain from product name
        const slug = product.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9-]/g, '');
        baseUrl = `https://${slug}.com`;
      }

      // Try guessed changelog URLs
      const guessedUrls = guessChangelogUrls(baseUrl);
      for (const url of guessedUrls) {
        const result = await fetchPage(url);
        if (result.ok && result.text.length > 500) {
          resolvedUrl = url;
          fetched = true;
          changelogText = stripHtml(result.text);
          sources.push({
            url,
            tier: 'S',
            bias: 'conflicted',
            fetched_at: new Date().toISOString(),
            contribution: `Live competitor changelog page — self-reported but immutable at fetch time`,
          });

          // Also try Wayback Machine
          const domain = url.replace(/https?:\/\//, '').split('/')[0];
          const waybackUrl = `https://web.archive.org/web/2024*/${domain}/changelog`;
          sources.push({
            url: waybackUrl,
            tier: 'S',
            bias: 'conflicted',
            fetched_at: new Date().toISOString(),
            contribution: `Wayback Machine snapshot of competitor-authored changelog for ${product} — content is conflicted (competitor's words), URL host is independent. Positioning evidence per spec §4 rule 6 (not independent).`,
          });
          break;
        }
      }

      // Fall back to serper if no changelog found
      if (!fetched) {
        fallbacksUsed.push('Changelog URL guessing failed — falling back to Serper search');
        if (!isSerperLive()) fallbacksUsed.push('serper (stub — set SERPER_API_KEY)');

        const searchQuery = `${product} changelog release notes`;
        const searchResults = await serperSearch(searchQuery, 5);
        if (searchResults.length > 0) {
          const topResult = searchResults[0];
          resolvedUrl = topResult.link;
          const fetchResult = await fetchPage(topResult.link);
          if (fetchResult.ok) {
            fetched = true;
            changelogText = stripHtml(fetchResult.text);
            sources.push({
              url: topResult.link,
              tier: 'S',
              bias: 'conflicted',
              fetched_at: new Date().toISOString(),
              contribution: `Changelog page found via search: ${topResult.title}`,
            });
          } else {
            resolvedUrl = topResult.link;
            changelogText = topResult.snippet;
            sources.push({
              url: topResult.link,
              tier: 'B',
              bias: 'conflicted',
              fetched_at: new Date().toISOString(),
              contribution: `Competitor self-hosted/published content for ${product} — positioning evidence per spec §4 rule 6 (not independent). Search snippet only (full page not fetched): ${topResult.snippet}`,
            });
          }
        } else {
          resolvedUrl = baseUrl;
          changelogText = '';
        }
      }

      const entries = parseChangelogEntries(changelogText, resolvedUrl);
      const allSignals = [...new Set(entries.flatMap((e) => e.failure_signals))] as FailureSignal[];

      let interpretation: string;
      if (!fetched || entries.length === 0) {
        interpretation = `Could not fetch a structured changelog for ${product}. This may indicate the product has no public changelog (opaque development), or the changelog lives behind a login. Consider this a mild risk signal.`;
      } else {
        const signalCount = allSignals.length;
        if (signalCount === 0) {
          interpretation = `No failure signals detected in ${entries.length} changelog entries. Product appears to be iterating cleanly. Low exploitation opportunity from changelog alone — use map_competitive_weaknesses for user sentiment.`;
        } else {
          interpretation = `Detected ${signalCount} failure signal type(s) across ${entries.length} entries: ${allSignals.join(', ')}. These indicate potential exploitable gaps. Cross-reference with Reddit/HN user complaints via map_competitive_weaknesses.`;
        }
      }

      // Phase 09: classify the response.
      //   - fetched: false + no entries → honest gap (search snippets had nothing too)
      //   - fetched: true + no entries → ok (changelog exists, just no relevant entries)
      //   - any entries → ok
      // Note: when the changelog page itself can't be fetched AND search
      // returned nothing, that's still an honest gap, not an error — we
      // never had a tool-level exception, just a clean empty result.
      const envelopeData = {
        resolved_url: resolvedUrl,
        fetched,
        entries,
        failure_signals_found: allSignals,
        interpretation,
      };
      const envelopeNote = fetched
        ? `Live changelog fetched from ${resolvedUrl}. Source is competitor-controlled (conflicted bias) but content is immutable at fetch time (S tier).`
        : `Could not fetch live changelog. Results based on search snippets only — lower confidence.`;
      const result: ToolResult<ReadCompetitorChangelogData> =
        entries.length === 0 && !fetched
          ? honestGapResult(envelopeData, sources, envelopeNote, fallbacksUsed)
          : okResult(envelopeData, sources, envelopeNote, fallbacksUsed);

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
