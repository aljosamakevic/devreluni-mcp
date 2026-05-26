// Phase 04 D-03-1 resolution — process-local cache with hit/miss instrumentation.
//
// Counters are monotonic since process start (Fly machine boot). cacheStats()
// reports them + a derived hit_rate as a fraction in [0, 1] (null when no
// invocations yet — distinguishes "0/0 unknown" from "0/N legit-zero").
//
// Cache layer remains in-process — multi-process / Redis-backed cache is a
// Phase 04+ candidate. The counters are reset on every machine restart;
// surface them through /health so Fly metrics + manual `curl /health` show
// the live ratio without needing a separate metrics endpoint.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

let hits = 0;
let misses = 0;

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) {
    misses++;
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    misses++;
    return null;
  }
  hits++;
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function makeCacheKey(...parts: string[]): string {
  return parts.join(':').toLowerCase().replace(/\s+/g, '_');
}

export interface CacheStats {
  hits: number;
  misses: number;
  /** hits / (hits + misses) in [0, 1]; null when no invocations yet. */
  hit_rate: number | null;
}

export function cacheStats(): CacheStats {
  const total = hits + misses;
  return {
    hits,
    misses,
    hit_rate: total === 0 ? null : hits / total,
  };
}

/** Test-only: zeroes the counters AND empties the store. Not exported by index. */
export function __resetCacheForTests(): void {
  store.clear();
  hits = 0;
  misses = 0;
}

export const TTL = {
  SHORT: 5 * 60 * 1000,
  MEDIUM: 60 * 60 * 1000,
  LONG: 24 * 60 * 60 * 1000,
};
