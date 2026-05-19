export interface FetchResult {
  url: string;
  status: number;
  text: string;
  ok: boolean;
}

export async function fetchPage(url: string): Promise<FetchResult> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; product-validation-mcp/0.1.0)',
        Accept: 'text/html,application/xhtml+xml,text/plain',
      },
      redirect: 'follow',
    });
    const text = await response.text();
    return { url, status: response.status, text, ok: response.ok };
  } catch (err) {
    return {
      url,
      status: 0,
      text: `Fetch error: ${err instanceof Error ? err.message : String(err)}`,
      ok: false,
    };
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Guess changelog URLs for a given domain.
 */
export function guessChangelogUrls(domain: string): string[] {
  const base = domain.replace(/\/$/, '');
  return [
    `${base}/changelog`,
    `${base}/releases`,
    `${base}/whats-new`,
    `${base}/updates`,
    `${base}/blog/changelog`,
    `${base}/blog/releases`,
  ];
}
