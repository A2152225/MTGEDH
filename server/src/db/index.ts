import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

type DB = Database.Database;

let db: DB | null = null;

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const DB_FILE = path.join(DATA_DIR, 'mtgedh.sqlite');

export async function initDb(): Promise<void> {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // Open database
  db = new Database(DB_FILE);
  // Pragmas for WAL and durability
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  // Schema: minimal games + events for event-sourced replay
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      game_id TEXT PRIMARY KEY,
      format TEXT NOT NULL,
      starting_life INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT,        -- JSON string of the event payload
      ts INTEGER NOT NULL, -- epoch ms
      FOREIGN KEY (game_id) REFERENCES games(game_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS events_game_idx ON events(game_id, id);
    CREATE INDEX IF NOT EXISTS events_game_seq_idx ON events(game_id, seq);
  `);
}

/**
 * Ensure a row exists in games; keeps format/starting_life updated.
 */
// Replace the existing createGameIfNotExists with this debug-friendly version.
export function createGameIfNotExists(gameId: string, format: string, startingLife: number): void {
  ensureDB();
  const now = Date.now();

  const insertSql = `
    INSERT OR IGNORE INTO games (game_id, format, starting_life, created_at)
    VALUES (?, ?, ?, ?)
  `;
  const updateSql = `UPDATE games SET format = ?, starting_life = ? WHERE game_id = ?`;

  try {
    const insert = db!.prepare(insertSql);
    // Log exact SQL and args to diagnose binding issues
    try {
      console.debug("[DB] Running insert:", insertSql.trim().replace(/\s+/g, " "));
      console.debug("[DB] Params:", { gameId, format, startingLife: startingLife | 0, now });
      insert.run(gameId, format, startingLife | 0, now);
    } catch (runErr) {
      console.error("[DB] insert.run failed:", runErr && (runErr as Error).message);
      console.error("[DB] insert statement source:", (insert as any).source ?? insertSql);
      // rethrow so caller sees failure after logging
      throw runErr;
    }

    // Keep metadata up to date (non-critical)
    const update = db!.prepare(updateSql);
    try {
      console.debug("[DB] Running update:", updateSql.trim().replace(/\s+/g, " "));
      console.debug("[DB] Params:", { format, startingLife: startingLife | 0, gameId });
      update.run(format, startingLife | 0, gameId);
    } catch (runErr) {
      console.error("[DB] update.run failed:", runErr && (runErr as Error).message);
      console.error("[DB] update statement source:", (update as any).source ?? updateSql);
      // swallow update error? rethrow so we can see debugging info — safer to rethrow
      throw runErr;
    }
  } catch (err) {
    // Bubble the original error after logging contextual info.
    console.error("[DB] createGameIfNotExists error:", err && (err as Error).message);
    throw err;
  }
}

export type PersistedEvent = {
  type: string;
  payload?: unknown;
};

/**
 * Return all persisted events for a game in insertion order.
 * socket.ts expects array items with shape { type, payload? }.
 */
export function getEvents(gameId: string): PersistedEvent[] {
  ensureDB();
  const stmt = db!.prepare<{ game_id: string }, { type: string; payload: string | null }>(
    `SELECT type, payload FROM events WHERE game_id = ? ORDER BY id ASC`
  );
  const rows = stmt.all(gameId);
  return rows.map((r) => ({
    type: r.type,
    payload: safeParseJSON(r.payload),
  }));
}

/**
 * Append one event to the log (used by socket handlers).
 *
 * Robustness:
 * - If the insert fails due to a missing games FK, create a minimal games row
 *   (INSERT OR IGNORE) with safe defaults and retry the insert once.
 */
export function appendEvent(gameId: string, seq: number, type: string, payload: unknown): number {
  ensureDB();

  const stmt = db!.prepare(
    `INSERT INTO events (game_id, seq, type, payload, ts) VALUES (?, ?, ?, ?, ?)`
  );
  const payloadJson = payload == null ? null : JSON.stringify(payload);

  // attempt and on FK error try to create games row then retry
  try {
    const info = stmt.run(gameId, seq | 0, type, payloadJson, Date.now());
    return Number(info.lastInsertRowid);
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    const isFk =
      err?.code === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
      /foreign key constraint failed/i.test(msg) ||
      /SQLITE_CONSTRAINT_FOREIGNKEY/i.test(msg);

    if (!isFk) {
      // not a FK error — rethrow
      throw err;
    }

    // FK error: create minimal games row and retry once
    try {
      // Use createGameIfNotExists if DB initialized (it will run INSERT OR IGNORE too)
      try {
        createGameIfNotExists(gameId, "commander", 40);
      } catch (createErr) {
        // Fallback: run direct insert-or-ignore using db handle
        try {
          db!.prepare("INSERT OR IGNORE INTO games (game_id, format, starting_life, created_at) VALUES (?, ?, ?, ?)").run(
            gameId,
            "commander",
            40,
            Date.now()
          );
        } catch (e2) {
          console.warn("appendEvent: failed to create games row on FK error (createGameIfNotExists fallback failed):", e2);
          throw err; // rethrow original
        }
      }

      // retry insert
      const info2 = stmt.run(gameId, seq | 0, type, payloadJson, Date.now());
      return Number(info2.lastInsertRowid);
    } catch (retryErr) {
      console.error("appendEvent: retry after creating games row failed:", retryErr);
      throw retryErr;
    }
  }
}

/* ====================== helpers ====================== */

function ensureDB(): asserts db is DB {
  if (!db) throw new Error('DB not initialized. Call initDb() first.');
}

function safeParseJSON(text: string | null): unknown {
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}