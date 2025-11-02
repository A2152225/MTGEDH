import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db: Database.Database;

export function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

export async function initDb() {
  const file = process.env.SQLITE_FILE || './data/mtgedh.sqlite';
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // @ts-expect-error ambient type provides Database.Database compatibility
  db = new Database(file);
  // @ts-expect-error ambient type provides pragma
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      format TEXT NOT NULL,
      starting_life INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS game_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(game_id) REFERENCES games(id)
    );
    CREATE INDEX IF NOT EXISTS idx_game_events_game_seq ON game_events(game_id, seq);
  `);
}

export interface GameRow {
  id: string;
  format: string;
  starting_life: number;
  created_at: number;
}

export interface PersistedEventRow {
  id: number;
  game_id: string;
  seq: number;
  type: string;
  payload: string; // JSON string
  created_at: number;
}

export function createGameIfNotExists(gameId: string, format: string, startingLife: number): void {
  const db = getDb();
  const getStmt = db.prepare(`SELECT id FROM games WHERE id = ?`);
  const row = getStmt.get(gameId) as { id: string } | undefined;
  if (row) return;
  const insert = db.prepare(`
    INSERT INTO games (id, format, starting_life, created_at) VALUES (?, ?, ?, ?)
  `);
  insert.run(gameId, format, startingLife, Date.now());
}

export function getGame(gameId: string): GameRow | undefined {
  const db = getDb();
  const stmt = db.prepare(`SELECT id, format, starting_life, created_at FROM games WHERE id = ?`);
  const row = stmt.get(gameId) as GameRow | undefined;
  return row;
}

export function appendEvent(gameId: string, seq: number, type: string, payload: unknown): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO game_events (game_id, seq, type, payload, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(gameId, seq, type, JSON.stringify(payload ?? {}), Date.now());
}

export function getEvents(gameId: string): Array<{ seq: number; type: string; payload: any }> {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT seq, type, payload
    FROM game_events
    WHERE game_id = ?
    ORDER BY seq ASC, id ASC
  `);
  const rows = stmt.all(gameId) as Pick<PersistedEventRow, 'seq' | 'type' | 'payload'>[];
  return rows.map(r => ({
    seq: r.seq,
    type: r.type,
    payload: safeParseJSON(r.payload)
  }));
}

function safeParseJSON(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}