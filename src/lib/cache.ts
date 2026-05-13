// Simple in-memory TTL cache — protects rate limits and speeds up repeated queries.
// Key format: "{source}:{query_hash}"

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function makeCacheKey(...parts: string[]): string {
  return parts.join(':').toLowerCase().replace(/\s+/g, '_');
}

// TTL presets
export const TTL = {
  SHORT: 5 * 60 * 1000,       //  5 minutes — SERP results
  MEDIUM: 60 * 60 * 1000,     //  1 hour   — GitHub stats, PH launches
  LONG: 24 * 60 * 60 * 1000,  // 24 hours  — subreddit meta, HN hiring threads
};
