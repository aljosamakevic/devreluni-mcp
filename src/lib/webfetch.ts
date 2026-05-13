// Web fetcher — used by read_competitor_changelog to pull live pages.
// No auth required. Respects robots.txt in spirit (public pages only).

const DEFAULT_UA = 'ProductValidationMCP/0.1 (research tool; not for scraping)';

export interface FetchResult {
  url: string;
  status: number;
  text: string;
  ok: boolean;
}

export async function fetchPage(url: string): Promise<FetchResult> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': DEFAULT_UA,
      'Accept': 'text/html,application/xhtml+xml,text/plain',
    },
    signal: AbortSignal.timeout(10_000),
  });

  const text = await response.text();
  return { url, status: response.status, text, ok: response.ok };
}

// Naive HTML stripper — good enough to extract text from changelogs.
// Swap for a proper parser (e.g. node-html-parser) in production.
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
