import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { SavedDeckSummary, SavedDeckDetail } from '../../shared/src/decks';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'mtgedh.sqlite');
const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  card_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS decks_created_at_idx ON decks(created_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO decks (id, name, text, created_at, created_by_id, created_by_name, card_count)
  VALUES (@id, @name, @text, @created_at, @created_by_id, @created_by_name, @card_count)
`);
const listStmt = db.prepare(`SELECT id, name, created_at, created_by_id, created_by_name, card_count FROM decks ORDER BY created_at DESC`);
const getStmt = db.prepare(`SELECT * FROM decks WHERE id = ?`);
const renameStmt = db.prepare(`UPDATE decks SET name = ? WHERE id = ?`);
const deleteStmt = db.prepare(`DELETE FROM decks WHERE id = ?`);

interface DeckRow {
  id: string;
  name: string;
  text: string;
  created_at: number;
  created_by_id: string;
  created_by_name: string;
  card_count: number;
}

export function saveDeck(deck: {
  id: string;
  name: string;
  text: string;
  created_by_id: string;
  created_by_name: string;
  card_count: number;
}) {
  insertStmt.run({
    ...deck,
    created_at: Date.now()
  });
}

export function listDecks(): SavedDeckSummary[] {
  return listStmt.all() as SavedDeckSummary[];
}

export function getDeck(id: string): SavedDeckDetail | null {
  const row = getStmt.get(id) as DeckRow | undefined;
  if (!row) return null;
  const summary: SavedDeckSummary = {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    created_by_id: row.created_by_id,
    created_by_name: row.created_by_name,
    card_count: row.card_count
  };
  const entries = parseDecklistEntries(row.text);
  return { ...summary, text: row.text, entries };
}

export function renameDeck(id: string, name: string): SavedDeckSummary | null {
  renameStmt.run(name, id);
  const d = getDeck(id);
  if (!d) return null;
  const { text, entries, ...summary } = d;
  return summary;
}

export function deleteDeck(id: string): boolean {
  const info = deleteStmt.run(id);
  return info.changes > 0;
}

/* Reuse parse logic (names + counts) without server import validation */
export function parseDecklistEntries(list: string): Array<{ name: string; count: number }> {
  const lines = (list || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const entries: Array<{ name: string; count: number }> = [];
  for (const line of lines) {
    // Accept formats like: "4 Lightning Bolt", "Lightning Bolt x4", "1x Sol Ring"
    let count = 1;
    let name = line;
    const m1 = line.match(/^(\d+)[xX]?\s+(.+)$/);
    const m2 = line.match(/^(.+?)\s+[xX](\d+)$/);
    if (m1) {
      count = parseInt(m1[1], 10) || 1;
      name = m1[2].trim();
    } else if (m2) {
      count = parseInt(m2[2], 10) || 1;
      name = m2[1].trim();
    }
    entries.push({ name, count });
  }
  return entries;
}

export function totalCountFromEntries(entries: Array<{ name: string; count: number }>): number {
  return entries.reduce((a, e) => a + e.count, 0);
}