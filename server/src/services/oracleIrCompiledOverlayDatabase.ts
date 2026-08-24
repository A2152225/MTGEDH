/**
 * Origin: extracted from the shared connection in `localCardLookup.ts`.
 *
 * Cluster: the SQLite connection backing `oracle_ir_compiled_overlay`. Previously every
 * overlay read/write borrowed the card-lookup connection, so the only writable table in
 * the 137 MB card-lookup database forced test runs to clone the whole file for isolation.
 *
 * Set `ORACLE_IR_OVERLAY_SQLITE_FILE` to keep overlays in their own (small) database.
 * Left unset, overlays continue to live in the card-lookup database exactly as before,
 * so production behavior is unchanged.
 *
 * Public entry points: getCompiledOracleIROverlayDatabase,
 * resetCompiledOracleIROverlayDatabaseForTests.
 */
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

import { ensureLocalCardLookupIndexSync, getLocalCardLookupDatabase } from './localCardLookup.js';

type DB = Database.Database;

const OVERLAY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS oracle_ir_compiled_overlay (
    overlay_key TEXT PRIMARY KEY,
    card_id TEXT,
    normalized_name TEXT,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS oracle_ir_overlay_card_id_idx ON oracle_ir_compiled_overlay(card_id);
  CREATE INDEX IF NOT EXISTS oracle_ir_overlay_name_idx ON oracle_ir_compiled_overlay(normalized_name);
`;

let overlayDb: DB | null = null;
let overlayDbFilePath: string | null = null;

function resolveOverlayDbFileOverride(): string {
  const configured = String(process.env.ORACLE_IR_OVERLAY_SQLITE_FILE || '').trim();
  if (!configured) return '';
  if (configured === ':memory:') return configured;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

function closeOverlayDatabase(): void {
  if (!overlayDb) return;
  try {
    overlayDb.close();
  } catch {
    // ignore close failures
  }
  overlayDb = null;
  overlayDbFilePath = null;
}

export function getCompiledOracleIROverlayDatabase(): DB {
  const override = resolveOverlayDbFileOverride();

  if (!override) {
    closeOverlayDatabase();
    ensureLocalCardLookupIndexSync();
    return getLocalCardLookupDatabase();
  }

  if (overlayDb && overlayDbFilePath === override) return overlayDb;

  closeOverlayDatabase();

  if (override !== ':memory:') {
    const dir = path.dirname(override);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const database = new Database(override);
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = NORMAL');
  database.exec(OVERLAY_SCHEMA);

  overlayDb = database;
  overlayDbFilePath = override;
  return database;
}

export function resetCompiledOracleIROverlayDatabaseForTests(): void {
  closeOverlayDatabase();
}
