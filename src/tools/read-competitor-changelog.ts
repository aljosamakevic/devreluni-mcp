import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchPage, stripHtml } from '../lib/webfetch.js';
import { searchWeb } from '../lib/serper.js';
import type { SignalResult, ChangelogEntry } from '../types.js';

// Patterns that reveal where the original pitch failed contact with users.
const FAILURE_SIGNAL_PATTERNS: Record<string, RegExp> = {
  'setup creep': /setup|onboard|configur|get started|wizard|tell us/i,
  'privacy concern': /privacy|screenshot|record|monitor|track|surveillance/i,
  'platform gap': /mobile|ios|android|windows|linux|browser extension/i,
  'churn signal': /cancel|refund|pause|unsubscrib|discontinu/i,
  'performance issue': /slow|crash|bug|fix|lag|memory|cpu/i,
  'scope expansion': /new feature|added|introducing|now support|we heard/i,
  'pitch vs reality': /instead of|we realized|turns out|actually|in practice/i,
};

function extractFailureSignals(text: string): string[] {
  return Object.entries(FAILURE_SIGNAL_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([signal]) => signal);
}

// Common changelog URL patterns to try when only a product name is given.
function guessChangelogUrls(name: string): string[] {
  const slug = name.toLowerCase().replace(/\s+/g, '');
  return [
    `https://${slug}.com/changelog`,
    `https://${slug}.com/updates`,
    `https://${slug}.com/release-notes`,
    `https://www.${slug}.com/changelog`,
    `https://changelog.${slug}.com`,
  ];
}

export function registerReadCompetitorChangelog(server: McpServer) {
  server.registerTool(
    'read_competitor_changelog',
    {
      description:
        'Read a competitor\'s changelog — not their homepage. Changelogs reveal what broke in v1, what users complained about, and where the original pitch failed contact with reality. This is the highest-signal competitive intel that exists.',
      inputSchema: {
        product: z
          .string()
          .describe('Product name (e.g. "Fomi") or direct changelog URL (e.g. "https://fomi.app/changelog")'),
      },
    },
    async ({ product }) => {
      const isUrl = product.startsWith('http');
      let changelogText = '';
      let resolvedUrl = product;
      let fetched = false;

      if (isUrl) {
        // Direct URL provided — fetch it
        try {
          const result = await fetchPage(product);
          if (result.ok) {
            changelogText = stripHtml(result.text).slice(0, 8000);
            fetched = true;
          }
        } catch {
          console.error(`[changelog] Failed to fetch ${product}`);
        }
      } else {
        // Product name — try guessed URLs first, then fall back to Serper
        for (const url of guessChangelogUrls(product)) {
          try {
            const result = await fetchPage(url);
            if (result.ok && result.text.length > 500) {
              changelogText = stripHtml(result.text).slice(0, 8000);
              resolvedUrl = url;
              fetched = true;
              break;
            }
          } catch {
            continue;
          }
        }

        // If direct fetch failed, search for the changelog URL
        if (!fetched) {
          const searchResult = await searchWeb(`${product} changelog site:${product.toLowerCase().replace(/\s+/g, '')}.com OR "${product}" changelog release notes`);
          if (searchResult.organic.length > 0) {
            resolvedUrl = searchResult.organic[0].link;
            try {
              const result = await fetchPage(resolvedUrl);
              if (result.ok) {
                changelogText = stripHtml(result.text).slice(0, 8000);
                fetched = true;
              }
            } catch {
              console.error(`[changelog] Failed to fetch found URL: ${resolvedUrl}`);
            }
          }
        }
      }

      // Parse changelog into entries (naive split on version/date headers)
      const entries: ChangelogEntry[] = [];
      if (fetched && changelogText) {
        // Split on common version patterns: "v1.2", "Version 1.2", "January 2025", "2025-01-15"
        const sections = changelogText.split(
          /(?=v\d+\.\d+|Version \d|January|February|March|April|May|June|July|August|September|October|November|December|\d{4}-\d{2}-\d{2})/i,
        );

        for (const section of sections.slice(0, 8)) {
          if (section.trim().length < 20) continue;
          const preview = section.slice(0, 500);
          entries.push({
            summary: preview,
            raw: section.slice(0, 1000),
            failure_signals: extractFailureSignals(section),
          });
        }
      }

      // Fallback entry when fetch fails
      if (!fetched) {
        entries.push({
          summary: `Could not fetch changelog for "${product}". Try providing the direct URL.`,
          raw: '',
          failure_signals: [],
        });
      }

      const allSignals = [...new Set(entries.flatMap((e) => e.failure_signals))];

      const result: SignalResult<{
        resolved_url: string;
        fetched: boolean;
        entries: ChangelogEntry[];
        failure_signals_found: string[];
        interpretation: string;
      }> = {
        signal_type: 'competitor_changelog',
        source: resolvedUrl,
        query: product,
        timestamp: new Date().toISOString(),
        stubbed: !fetched,
        data: {
          resolved_url: resolvedUrl,
          fetched,
          entries,
          failure_signals_found: allSignals,
          interpretation:
            allSignals.length > 0
              ? `Found ${allSignals.length} failure signal(s): ${allSignals.join(', ')}. These reveal where the original pitch met reality. Run map_competitive_weaknesses to cross-reference with community complaints.`
              : fetched
              ? 'No obvious failure signals detected. Changelog may be sparse or product is early stage.'
              : 'Could not fetch changelog — try providing the direct URL.',
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
