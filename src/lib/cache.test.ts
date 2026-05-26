import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { cacheGet, cacheSet, cacheStats, makeCacheKey, TTL, __resetCacheForTests } from './cache.js';

describe('cache API', () => {
  it('cacheGet on unknown key returns null', () => {
    expect(cacheGet('definitely-not-a-real-key-' + Math.random())).toBeNull();
  });

  it('cacheSet then cacheGet returns the stored value', () => {
    const key = 'test-key-set-get-' + Math.random();
    const value = { v: 1, nested: { ok: true } };
    cacheSet(key, value, TTL.SHORT);
    expect(cacheGet(key)).toEqual(value);
  });

  it('makeCacheKey produces a deterministic string for the same inputs', () => {
    const k1 = makeCacheKey('foo', 'bar', 'baz');
    const k2 = makeCacheKey('foo', 'bar', 'baz');
    expect(k1).toBe(k2);
    expect(typeof k1).toBe('string');
    expect(k1.length).toBeGreaterThan(0);
  });

  it('makeCacheKey produces different keys for different arg orders', () => {
    const k1 = makeCacheKey('alpha', 'beta', 'gamma');
    const k2 = makeCacheKey('gamma', 'beta', 'alpha');
    expect(k1).not.toBe(k2);
  });

  it('TTL expiry: entries past their TTL return null', async () => {
    const key = 'test-key-ttl-expiry-' + Math.random();
    cacheSet(key, 'value', 1); // 1ms TTL
    await new Promise((r) => setTimeout(r, 10));
    expect(cacheGet(key)).toBeNull();
  });

  it('same key with different types overwrites prior value', () => {
    const key = 'test-key-overwrite-' + Math.random();
    cacheSet(key, 'string', TTL.SHORT);
    expect(cacheGet(key)).toBe('string');
    cacheSet(key, 42, TTL.SHORT);
    expect(cacheGet(key)).toBe(42);
  });
});

describe('TTL constants', () => {
  it('TTL.SHORT < TTL.MEDIUM < TTL.LONG (ordering invariant)', () => {
    expect(TTL.SHORT).toBeLessThan(TTL.MEDIUM);
    expect(TTL.MEDIUM).toBeLessThan(TTL.LONG);
  });

  it('TTL.SHORT is at least 1 minute (60_000 ms)', () => {
    expect(TTL.SHORT).toBeGreaterThanOrEqual(60_000);
  });

  it('TTL.LONG is at most 7 days', () => {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    expect(TTL.LONG).toBeLessThanOrEqual(SEVEN_DAYS_MS);
  });
});

describe('cacheStats — D-03-1 hit/miss instrumentation', () => {
  // These tests need isolated counter state because they assert exact
  // hit/miss numbers; reset before AND after to keep them hermetic and
  // to avoid leaking counter state into any test that runs after this file.
  beforeEach(() => {
    __resetCacheForTests();
  });

  afterEach(() => {
    __resetCacheForTests();
  });

  it('returns hit_rate null when no invocations yet', () => {
    const s = cacheStats();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
    expect(s.hit_rate).toBeNull();
  });

  it('counts every miss on an empty store', () => {
    cacheGet('k1');
    cacheGet('k2');
    cacheGet('k3');
    const s = cacheStats();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(3);
    expect(s.hit_rate).toBe(0);
  });

  it('counts a hit after cacheSet', () => {
    cacheSet('warm', 42, TTL.SHORT);
    expect(cacheGet<number>('warm')).toBe(42);
    expect(cacheGet<number>('warm')).toBe(42);
    const s = cacheStats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(0);
    expect(s.hit_rate).toBe(1);
  });

  it('reports a proportional hit_rate', () => {
    cacheSet('warm', 'v', TTL.SHORT);
    cacheGet('warm');  // hit
    cacheGet('cold');  // miss
    cacheGet('warm');  // hit
    cacheGet('cold');  // miss
    cacheGet('warm');  // hit
    const s = cacheStats();
    expect(s.hits).toBe(3);
    expect(s.misses).toBe(2);
    expect(s.hit_rate).toBeCloseTo(0.6, 10);
  });

  it('counts expired entries as misses (not silent hits)', async () => {
    cacheSet('stale', 'v', 1); // 1 ms TTL
    await new Promise((r) => setTimeout(r, 10));
    expect(cacheGet('stale')).toBeNull();
    const s = cacheStats();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(1);
  });
});
