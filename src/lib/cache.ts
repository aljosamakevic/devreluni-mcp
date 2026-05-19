interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function makeCacheKey(...parts: string[]): string {
  return parts.join(':').toLowerCase().replace(/\s+/g, '_');
}

export const TTL = {
  SHORT: 5 * 60 * 1000,
  MEDIUM: 60 * 60 * 1000,
  LONG: 24 * 60 * 60 * 1000,
};
