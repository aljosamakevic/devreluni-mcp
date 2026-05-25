import type { ToolSource } from '../types.js';

export interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

export interface SerperResponse {
  organic: SerperOrganicResult[];
  searchParameters?: { q: string };
}

const SERPER_BASE = 'https://google.serper.dev/search';

export async function serperSearch(query: string, num = 10): Promise<SerperOrganicResult[]> {
  const apiKey = process.env['SERPER_API_KEY'];
  if (!apiKey) {
    return getSerperStub(query);
  }

  try {
    const response = await fetch(SERPER_BASE, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num }),
    });

    if (!response.ok) {
      throw new Error(`Serper returned ${response.status}`);
    }

    const data = (await response.json()) as SerperResponse;
    return data.organic ?? [];
  } catch (err) {
    console.error('[serper.ts] serperSearch error:', err);
    return getSerperStub(query);
  }
}

function getSerperStub(query: string): SerperOrganicResult[] {
  return [
    {
      title: `[STUB] Top result for: ${query}`,
      link: 'https://example.com/stub-result-1',
      snippet: `[STUB DATA — set SERPER_API_KEY for live results] This is a placeholder result for the query: "${query}". Real search would return actual competitor pages and market data.`,
      position: 1,
    },
    {
      title: `[STUB] Second result for: ${query}`,
      link: 'https://example.com/stub-result-2',
      snippet: `[STUB DATA] Another placeholder result. Real results would include relevant market intelligence, pricing pages, and competitor landing pages.`,
      position: 2,
    },
  ];
}

export function isSerperLive(): boolean {
  return Boolean(process.env['SERPER_API_KEY']);
}

export function serperSource(query: string): ToolSource {
  const live = isSerperLive();
  return {
    url: `https://google.serper.dev/search?q=${encodeURIComponent(query)}`,
    tier: live ? 'A' : 'D',
    bias: live ? 'independent' : 'unknown',
    fetched_at: new Date().toISOString(),
    contribution: live
      ? `Google search results for: ${query}`
      : `[STUB] Placeholder search results for: ${query} — set SERPER_API_KEY for live data`,
  };
}

export function serperConfidenceNote(): string {
  return isSerperLive()
    ? 'Serper search data is live.'
    : 'Set SERPER_API_KEY for live search data. Results are stubbed.';
}
