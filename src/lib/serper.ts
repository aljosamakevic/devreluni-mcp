import type { ToolSource } from '../types.js';
import { checkGlobalSerperLimit, recordSerperCall } from '../ratelimit/global.js';
import { logger } from './logger.js';

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

// Phase 03 T12 — graceful-degradation tag (C7 final disposition):
// when the global Serper cap fires on the LIVE call path, serperSearch
// returns stub data identical to the no-API-key path, and tool callers
// (or wasLastSerperCallCapped() consumers) can push this tag into the
// envelope's fallbacks_used so the gap is surfaced honestly. NO 429
// is emitted for the global cap — see src/ratelimit/global.ts header.
export const SERPER_GLOBAL_CAP_FALLBACK = 'serper_global_cap';

let lastCallWasCapped = false;

export function wasLastSerperCallCapped(): boolean {
  return lastCallWasCapped;
}

export async function serperSearch(query: string, num = 10): Promise<SerperOrganicResult[]> {
  lastCallWasCapped = false;
  const apiKey = process.env['SERPER_API_KEY'];
  if (!apiKey) {
    return getSerperStub(query);
  }

  // T12 — global cap check happens BEFORE any network call so the daily
  // budget is honored. On cap-hit we degrade to the same stub shape as
  // the no-API-key path and set lastCallWasCapped so callers can push
  // 'serper_global_cap' into fallbacks_used. (T21 will switch console.warn
  // to a pino structured warn.)
  const cap = checkGlobalSerperLimit();
  if (!cap.allowed) {
    lastCallWasCapped = true;
    logger.warn(
      {
        event: 'serper_global_cap_hit',
        retry_after_sec: cap.retryAfterSec,
        fallback: SERPER_GLOBAL_CAP_FALLBACK,
      },
      'serper_global_cap_hit'
    );
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
    // Successful live call — increment today's global counter (R5 race
    // window per src/ratelimit/global.ts is acceptable).
    recordSerperCall();
    return data.organic ?? [];
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'serper_search_error'
    );
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
