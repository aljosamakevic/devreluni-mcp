// Phase 03 T15 — Unit tests for src/ratelimit/global.ts +
// the graceful-degradation contract wired into src/lib/serper.ts.
//
// Locks:
//   - 1500-call / UTC day threshold
//   - recordSerperCall transactional increment
//   - UTC-midnight reset via the new YYYY-MM-DD key
//   - C7 graceful-degradation contract: when capped, serperSearch returns
//     the no-API-key stub shape, does NOT throw, does NOT return a 429, and
//     wasLastSerperCallCapped() reports true.
//   - Literal 'serper_global_cap' fallback tag in src/lib/serper.ts.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetDbForTests, getDb } from '../db/connection.js';
import {
  checkGlobalSerperLimit,
  GLOBAL_SERPER_LIMIT,
  recordSerperCall,
} from './global.js';
import {
  SERPER_GLOBAL_CAP_FALLBACK,
  serperSearch,
  wasLastSerperCallCapped,
} from '../lib/serper.js';

const DB_PATH = join(tmpdir(), `vetoed-test-global-${randomBytes(6).toString('hex')}.db`);

function cleanup(): void {
  __resetDbForTests();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${DB_PATH}${suffix}`;
    if (existsSync(p)) {
      try {
        rmSync(p);
      } catch {
        // best-effort
      }
    }
  }
}

beforeAll(() => {
  process.env['VETOED_DB_PATH'] = DB_PATH;
  cleanup();
  getDb();
});

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM rate_limits;');
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env['SERPER_API_KEY'];
});

afterAll(() => {
  cleanup();
});

function todayKey(): string {
  return `global:serper:${new Date().toISOString().slice(0, 10)}`;
}

function seedCount(count: number): void {
  const db = getDb();
  const windowStart = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
      0,
      0,
      0,
      0
    )
  ).toISOString();
  db.prepare(`INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?, ?, ?)`).run(
    todayKey(),
    count,
    windowStart
  );
}

describe('checkGlobalSerperLimit — threshold semantics', () => {
  it('allows when no row exists for today (count=0)', () => {
    const result = checkGlobalSerperLimit();
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(GLOBAL_SERPER_LIMIT);
    expect(result.retryAfterSec).toBe(0);
  });

  it('allows at count=1499 with remaining=1', () => {
    seedCount(1499);
    const result = checkGlobalSerperLimit();
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it('blocks at count=1500 with retryAfterSec > 0 (seconds until UTC midnight)', () => {
    seedCount(1500);
    const result = checkGlobalSerperLimit();
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSec).toBeGreaterThan(0);
    expect(result.retryAfterSec).toBeLessThanOrEqual(24 * 60 * 60);
  });
});

describe('recordSerperCall — transactional increment', () => {
  it('inserts a new row on the first call of the day', () => {
    recordSerperCall();
    const db = getDb();
    const row = db
      .prepare(`SELECT count FROM rate_limits WHERE key = ?`)
      .get(todayKey()) as { count: number };
    expect(row.count).toBe(1);
  });

  it('increments the existing row on subsequent calls', () => {
    seedCount(1499);
    recordSerperCall();
    const result = checkGlobalSerperLimit();
    // After recording, count is 1500 → at the cap.
    expect(result.allowed).toBe(false);
  });
});

describe('UTC midnight reset', () => {
  it('uses a new YYYY-MM-DD key after crossing UTC midnight (counter effectively resets)', () => {
    // Set system time to 23:59:59 UTC today.
    vi.useFakeTimers();
    const baseDate = new Date();
    const lateToday = new Date(
      Date.UTC(
        baseDate.getUTCFullYear(),
        baseDate.getUTCMonth(),
        baseDate.getUTCDate(),
        23,
        59,
        59,
        0
      )
    );
    vi.setSystemTime(lateToday);

    seedCount(1500);
    expect(checkGlobalSerperLimit().allowed).toBe(false);

    // Advance past UTC midnight — new day, new key.
    const nextDay = new Date(lateToday.getTime() + 2000);
    vi.setSystemTime(nextDay);

    // New day's key has no row yet → allowed=true with full remaining.
    const result = checkGlobalSerperLimit();
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(GLOBAL_SERPER_LIMIT);
  });
});

describe('serperSearch — C7 graceful degradation contract', () => {
  it('SERPER_GLOBAL_CAP_FALLBACK is the literal string "serper_global_cap"', () => {
    expect(SERPER_GLOBAL_CAP_FALLBACK).toBe('serper_global_cap');
  });

  it('returns stub-shape results (does NOT throw, does NOT return 429) when the global cap is hit on the live path', async () => {
    process.env['SERPER_API_KEY'] = 'test-key-forces-live-path';
    seedCount(GLOBAL_SERPER_LIMIT);

    // No fetch stub needed — the cap check fires BEFORE fetch is invoked,
    // so we never hit the network.
    const results = await serperSearch('test query');

    // Stub shape: 2 entries with [STUB] markers (matches getSerperStub).
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(2);
    expect(results[0].title).toContain('[STUB]');
    expect(results[0].snippet).toContain('[STUB DATA');

    // The cap-hit signal is exposed via wasLastSerperCallCapped(), so
    // tool callers can push SERPER_GLOBAL_CAP_FALLBACK into fallbacks_used.
    expect(wasLastSerperCallCapped()).toBe(true);
  });

  it('does NOT mark capped on the no-API-key stub path (cap check is live-only)', async () => {
    delete process.env['SERPER_API_KEY'];
    seedCount(GLOBAL_SERPER_LIMIT);
    const results = await serperSearch('no key test');
    expect(Array.isArray(results)).toBe(true);
    // Without an API key the cap branch is unreachable — wasCapped stays false.
    expect(wasLastSerperCallCapped()).toBe(false);
  });
});
