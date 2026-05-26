// Phase 03 T05 — better-sqlite3 connection wrapper.
// Singleton: first call opens the DB, applies schema, returns the handle.
// WAL journal mode is required for the rate-limit transaction pattern (PLAN R5).

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env['VETOED_DB_PATH'] ?? '/data/vetoed.db';
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // schema.sql lives next to this file in src/, and next to the compiled JS in build/db/.
  // Resolve relative to the module URL so it works under tsx (src/) and node (build/).
  const here = dirname(fileURLToPath(import.meta.url));
  const schemaPath = join(here, 'schema.sql');
  const schemaSql = readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);

  return db;
}

// Test helper — close the singleton so a fresh getDb() call rebuilds from a new path.
// Not exported for production code paths.
export function __resetDbForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
}
