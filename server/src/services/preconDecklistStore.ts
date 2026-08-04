import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import type { ParsedLine } from './scryfall.js';
import { debugWarn } from '../utils/debug.js';

const schemaVersion = '1';
const serviceDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(serviceDir, '../../..');
const defaultDbFile = path.join(repoRoot, 'server', 'data', 'precon-decklists.sqlite');

let db: Database.Database | null = null;
let dbFilePath: string | null = null;

export type PreconDeckSource = 'wizards' | 'moxfield' | 'mtgjson' | 'json-import' | 'manual';

export type PreconDeckMeta = {
  setCode: string;
  deckName: string;
  source: PreconDeckSource;
  sourceUrl: string | null;
  fetchedAt: number;
  cardCount: number;
  uniqueCount: number;
};

export type PreconDeckCardRow = {
  setCode: string;
  deckName: string;
  sortOrder: number;
  cardName: string;
  count: number;
};

function resolveDbFile(): string {
  const override = String(process.env.PRECON_DECKLIST_SQLITE_FILE || process.env.PRECON_SQLITE_FILE || '').trim();
  return override || defaultDbFile;
}

function getDatabase(): Database.Database {
  if (db) return db;

  const resolvedDbFile = resolveDbFile();
  if (resolvedDbFile !== ':memory:') {
    const dir = path.dirname(resolvedDbFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(resolvedDbFile);
  dbFilePath = resolvedDbFile;
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS precon_deck_meta (
      set_code TEXT NOT NULL,
      deck_name TEXT NOT NULL,
      source TEXT NOT NULL,
      source_url TEXT,
      fetched_at INTEGER NOT NULL,
      card_count INTEGER NOT NULL,
      unique_count INTEGER NOT NULL,
      PRIMARY KEY (set_code, deck_name)
    );

    CREATE TABLE IF NOT EXISTS precon_deck_cards (
      set_code TEXT NOT NULL,
      deck_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      card_name TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (set_code, deck_name, sort_order)
    );

    CREATE INDEX IF NOT EXISTS precon_deck_cards_lookup_idx
      ON precon_deck_cards(set_code, deck_name);

    CREATE TABLE IF NOT EXISTS precon_deck_store_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const row = db.prepare('SELECT value FROM precon_deck_store_meta WHERE key = ?').get('schema_version') as
    | { value: string }
    | undefined;
  if (!row) {
    db.prepare('INSERT OR REPLACE INTO precon_deck_store_meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      schemaVersion,
    );
  }

  return db;
}

export function getPreconDecklistDatabasePath(): string {
  getDatabase();
  return dbFilePath || resolveDbFile();
}

export function getPreconDecklistDatabase(): Database.Database {
  return getDatabase();
}

export function upsertPreconDecklist(
  setCode: string,
  deckName: string,
  lines: ParsedLine[],
  meta: {
    source: PreconDeckSource;
    sourceUrl?: string | null;
    fetchedAt?: number;
  },
): void {
  const database = getDatabase();
  const normalizedSet = String(setCode || '').trim().toUpperCase();
  const normalizedDeck = String(deckName || '').trim();
  if (!normalizedSet || !normalizedDeck || lines.length === 0) return;

  const cardCount = lines.reduce((sum, line) => sum + Math.max(1, line.count || 1), 0);
  const uniqueCount = lines.length;
  const fetchedAt = meta.fetchedAt ?? Date.now();

  const replaceDeck = database.transaction(() => {
    database
      .prepare(
        `INSERT OR REPLACE INTO precon_deck_meta
         (set_code, deck_name, source, source_url, fetched_at, card_count, unique_count)
         VALUES (@setCode, @deckName, @source, @sourceUrl, @fetchedAt, @cardCount, @uniqueCount)`,
      )
      .run({
        setCode: normalizedSet,
        deckName: normalizedDeck,
        source: meta.source,
        sourceUrl: meta.sourceUrl ?? null,
        fetchedAt,
        cardCount,
        uniqueCount,
      });

    database.prepare('DELETE FROM precon_deck_cards WHERE set_code = ? AND deck_name = ?').run(
      normalizedSet,
      normalizedDeck,
    );

    const insertCard = database.prepare(
      `INSERT INTO precon_deck_cards (set_code, deck_name, sort_order, card_name, count)
       VALUES (@setCode, @deckName, @sortOrder, @cardName, @count)`,
    );

    lines.forEach((line, index) => {
      insertCard.run({
        setCode: normalizedSet,
        deckName: normalizedDeck,
        sortOrder: index,
        cardName: String(line.name || '').trim(),
        count: Math.max(1, line.count || 1),
      });
    });
  });

  replaceDeck();
}

export function getPreconDecklistLines(setCode: string, deckName: string): ParsedLine[] | null {
  const normalizedSet = String(setCode || '').trim().toUpperCase();
  const normalizedDeck = String(deckName || '').trim();
  if (!normalizedSet || !normalizedDeck) return null;

  try {
    const database = getDatabase();
    const rows = database
      .prepare(
        `SELECT card_name, count
         FROM precon_deck_cards
         WHERE set_code = ? AND deck_name = ?
         ORDER BY sort_order ASC`,
      )
      .all(normalizedSet, normalizedDeck) as Array<{ card_name: string; count: number }>;

    if (rows.length === 0) return null;

    return rows.map((row) => ({
      name: row.card_name,
      count: Math.max(1, row.count || 1),
    }));
  } catch (error) {
    debugWarn(1, '[preconDecklistStore] failed to read decklist', { setCode, deckName, error });
    return null;
  }
}

export function listPreconDeckMeta(setCode?: string): PreconDeckMeta[] {
  const database = getDatabase();
  const rows = setCode
    ? (database
        .prepare(
          `SELECT set_code, deck_name, source, source_url, fetched_at, card_count, unique_count
           FROM precon_deck_meta WHERE set_code = ? ORDER BY deck_name ASC`,
        )
        .all(String(setCode).trim().toUpperCase()) as Array<Record<string, unknown>>)
    : (database
        .prepare(
          `SELECT set_code, deck_name, source, source_url, fetched_at, card_count, unique_count
           FROM precon_deck_meta ORDER BY set_code ASC, deck_name ASC`,
        )
        .all() as Array<Record<string, unknown>>);

  return rows.map((row) => ({
    setCode: String(row.set_code || ''),
    deckName: String(row.deck_name || ''),
    source: String(row.source || 'manual') as PreconDeckSource,
    sourceUrl: row.source_url ? String(row.source_url) : null,
    fetchedAt: Number(row.fetched_at || 0),
    cardCount: Number(row.card_count || 0),
    uniqueCount: Number(row.unique_count || 0),
  }));
}

export function countPreconDecks(setCode?: string): number {
  const database = getDatabase();
  if (setCode) {
    const row = database
      .prepare('SELECT COUNT(*) AS count FROM precon_deck_meta WHERE set_code = ?')
      .get(String(setCode).trim().toUpperCase()) as { count: number };
    return Number(row?.count || 0);
  }
  const row = database.prepare('SELECT COUNT(*) AS count FROM precon_deck_meta').get() as { count: number };
  return Number(row?.count || 0);
}
