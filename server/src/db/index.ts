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
      created_at INTEGER NOT NULL,
      created_by_socket_id TEXT,
      created_by_player_id TEXT
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
  
  // Migration: add created_by columns if they don't exist (for existing databases)
  try {
    // Check if columns exist by attempting to select them
    db.prepare('SELECT created_by_socket_id FROM games LIMIT 1').get();
  } catch {
    // Column doesn't exist, add it
    try {
      db.exec('ALTER TABLE games ADD COLUMN created_by_socket_id TEXT');
      console.log('[DB] Added created_by_socket_id column');
    } catch (e: any) {
      // Log migration failure unless it's a "duplicate column" error
      const errMsg = String(e?.message || '');
      if (!errMsg.toLowerCase().includes('duplicate column')) {
        console.warn('[DB] Migration warning for created_by_socket_id:', errMsg);
      }
    }
  }
  
  try {
    db.prepare('SELECT created_by_player_id FROM games LIMIT 1').get();
  } catch {
    try {
      db.exec('ALTER TABLE games ADD COLUMN created_by_player_id TEXT');
      console.log('[DB] Added created_by_player_id column');
    } catch (e: any) {
      // Log migration failure unless it's a "duplicate column" error
      const errMsg = String(e?.message || '');
      if (!errMsg.toLowerCase().includes('duplicate column')) {
        console.warn('[DB] Migration warning for created_by_player_id:', errMsg);
      }
    }
  }
}

/**
 * Ensure a row exists in games; keeps format/starting_life updated.
 * Optionally tracks who created the game via socketId and playerId.
 */
export function createGameIfNotExists(
  gameId: string, 
  format: string, 
  startingLife: number,
  createdBySocketId?: string,
  createdByPlayerId?: string
): void {
  ensureDB();

  // Defensive guard: invalid or empty gameId should never be persisted.
  if (!gameId || typeof gameId !== 'string' || gameId.trim() === '') {
    console.error("[DB] createGameIfNotExists called with invalid gameId:", String(gameId));
    // Do not proceed — caller should be fixed. Return early to avoid inserting bad rows.
    return;
  }

  const now = Date.now();

  const insertSql = `
    INSERT OR IGNORE INTO games (game_id, format, starting_life, created_at, created_by_socket_id, created_by_player_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  const updateSql = `UPDATE games SET format = ?, starting_life = ? WHERE game_id = ?`;

  try {
    const insert = db!.prepare(insertSql);
    // Log exact SQL and args to diagnose binding issues
    try {
      console.debug("[DB] Running insert:", insertSql.trim().replace(/\s+/g, " "));
      console.debug("[DB] Params:", { gameId, format, startingLife: startingLife | 0, now, createdBySocketId, createdByPlayerId });
      insert.run(gameId, format, startingLife | 0, now, createdBySocketId || null, createdByPlayerId || null);
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
      // rethrow so we can see debugging info
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
  const stmt = db!.prepare(
    `SELECT type, payload FROM events WHERE game_id = ? ORDER BY id ASC`
  );
  const rows = stmt.all(gameId) as Array<{ type: string; payload: string | null }>;
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

function ensureDB(): void {
  if (!db) throw new Error('DB not initialized. Call initDb() first.');
}

function safeParseJSON(text: string | null): unknown {
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

/**
 * Return a list of persisted games (basic metadata including creator info).
 */
export function listGames(): { 
  game_id: string; 
  format: string; 
  starting_life: number; 
  created_at: number;
  created_by_socket_id: string | null;
  created_by_player_id: string | null;
}[] {
  ensureDB();
  const stmt = db!.prepare(`SELECT game_id, format, starting_life, created_at, created_by_socket_id, created_by_player_id FROM games ORDER BY created_at DESC`);
  return stmt.all() as { 
    game_id: string; 
    format: string; 
    starting_life: number; 
    created_at: number;
    created_by_socket_id: string | null;
    created_by_player_id: string | null;
  }[];
}

/**
 * Check if a game exists in the database.
 * Used to prevent re-creating games that were previously deleted.
 * 
 * @param gameId The game ID to check
 * @returns true if the game exists in the database, false otherwise
 */
export function gameExistsInDb(gameId: string): boolean {
  ensureDB();
  try {
    const stmt = db!.prepare(`SELECT 1 FROM games WHERE game_id = ? LIMIT 1`);
    const result = stmt.get(gameId);
    return result !== undefined;
  } catch (err) {
    console.error("[DB] gameExistsInDb failed:", (err as Error).message);
    return false;
  }
}

/**
 * Delete persisted events and game metadata for a gameId.
 * Returns true on success.
 */
export function deleteGame(gameId: string): boolean {
  ensureDB();
  const delEvents = db!.prepare(`DELETE FROM events WHERE game_id = ?`);
  const delGame = db!.prepare(`DELETE FROM games WHERE game_id = ?`);
  const tx = db!.transaction((id: string) => {
    delEvents.run(id);
    const info = delGame.run(id);
    return info.changes > 0;
  });
  try {
    return tx(gameId);
  } catch (err) {
    console.error("[DB] deleteGame failed:", (err as Error).message);
    return false;
  }
}

/**
 * Truncate events for a game to support undo functionality.
 * Keeps only the first `keepCount` events and deletes the rest.
 * Returns the number of events deleted.
 */
export function truncateEventsForUndo(gameId: string, keepCount: number): number {
  ensureDB();
  
  // First get the IDs of events to keep (the first keepCount events)
  const getEventsStmt = db!.prepare(
    `SELECT id FROM events WHERE game_id = ? ORDER BY id ASC LIMIT ?`
  );
  const eventsToKeep = getEventsStmt.all(gameId, keepCount) as Array<{ id: number }>;
  
  if (eventsToKeep.length === 0) {
    // No events to keep, delete all
    const delAll = db!.prepare(`DELETE FROM events WHERE game_id = ?`);
    const info = delAll.run(gameId);
    return info.changes;
  }
  
  // Get the max ID to keep using reduce (safer than Math.max with spread for large arrays)
  // Use first element as initial value to handle edge cases correctly
  const maxIdToKeep = eventsToKeep.reduce((max, e) => Math.max(max, e.id), eventsToKeep[0].id);
  
  // Delete events with ID greater than the max ID to keep
  const delStmt = db!.prepare(
    `DELETE FROM events WHERE game_id = ? AND id > ?`
  );
  try {
    const info = delStmt.run(gameId, maxIdToKeep);
    console.log(`[DB] truncateEventsForUndo: deleted ${info.changes} events for game ${gameId}, kept ${keepCount}`);
    return info.changes;
  } catch (err) {
    console.error("[DB] truncateEventsForUndo failed:", (err as Error).message);
    return 0;
  }
}

/**
 * Get the count of events for a game.
 */
export function getEventCount(gameId: string): number {
  ensureDB();
  const stmt = db!.prepare(`SELECT COUNT(*) as count FROM events WHERE game_id = ?`);
  const result = stmt.get(gameId) as { count: number } | undefined;
  return result?.count || 0;
}

/**
 * Get creator info for a game.
 */
export function getGameCreator(gameId: string): { 
  created_by_socket_id: string | null; 
  created_by_player_id: string | null 
} | null {
  ensureDB();
  const stmt = db!.prepare(`SELECT created_by_socket_id, created_by_player_id FROM games WHERE game_id = ?`);
  const result = stmt.get(gameId) as { 
    created_by_socket_id: string | null; 
    created_by_player_id: string | null 
  } | undefined;
  return result || null;
}

/**
 * Check if a player is the creator of a game.
 * Returns true if the playerId matches the game's created_by_player_id.
 */
export function isGameCreator(gameId: string, playerId: string): boolean {
  const creator = getGameCreator(gameId);
  if (!creator || !creator.created_by_player_id) {
    return false;
  }
  return creator.created_by_player_id === playerId;
}

/**
 * Update the creator's player ID for a game.
 * This is called when the first player joins a game, as the initial socket ID
 * might not have a player ID yet.
 */
export function updateGameCreatorPlayerId(gameId: string, playerId: string): void {
  ensureDB();
  try {
    const stmt = db!.prepare(`UPDATE games SET created_by_player_id = ? WHERE game_id = ? AND created_by_player_id IS NULL`);
    stmt.run(playerId, gameId);
  } catch (err) {
    console.error("[DB] updateGameCreatorPlayerId failed:", (err as Error).message);
  }
}