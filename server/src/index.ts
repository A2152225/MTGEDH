import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
// registerSocketHandlers comes from the socket index (folder)
import { registerSocketHandlers } from "./socket/index.js";
import {
  initDb,
  listGames as dbListGames,
  deleteGame as dbDeleteGame,
} from "./db/index.js";
import { listDecks, saveDeck } from "./db/decks.js";
import { addSuggestion, loadSuggestions } from "./db/houseRuleSuggestions.js";
import { parseDecklist, clearPlaneswalkerCache } from "./services/scryfall";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from "../../shared/src/events";
import GameManager from "./GameManager.js"; // NEW: import GameManager
import { initCLI, setHttpServer } from "./cli"; // CLI support for server management
import { games as socketGames, priorityTimers } from "./socket/socket.js";
import { debug, debugWarn, debugError } from "./utils/debug.js";
import { BOOT_ID } from "./utils/bootId.js";

// Get the equivalent of __dirname in ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type StartupOptions = {
  port: number;
  corsOrigin: string;
  clearPlaneswalkerCache: boolean;
  wipeGamesOnStartup: boolean;
  showHelp: boolean;
};

function readBooleanEnv(name: string): boolean {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function printStartupHelp(): void {
  console.log(`
@mtgedh/server startup flags:

  --port <number>                Override PORT for this process.
  --cors-origin <origin>         Override CORS_ORIGIN for this process.
  --sqlite-file <path>           Override SQLITE_FILE / SQLITE_PATH for this process.
  --debug-state <0|1|2>          Override DEBUG_STATE for this process.
  --clear-planeswalker-cache     Force the Scryfall planeswalker cache to be cleared at startup.
  --wipe-games                   Delete persisted + in-memory games at startup.
  --wipe-games-on-startup        Alias for --wipe-games.
  --help                         Show this help and exit.

Examples:
  npm --workspace @mtgedh/server run dev -- --wipe-games
  npm --workspace @mtgedh/server run dev -- --port 3002 --debug-state 1
  npm --workspace @mtgedh/server run dev -- --sqlite-file ./data/dev.sqlite

Environment variable equivalents:
  PORT, CORS_ORIGIN, SQLITE_FILE, SQLITE_PATH, DEBUG_STATE,
  CLEAR_PLANESWALKER_CACHE, WIPE_GAMES_ON_STARTUP

Note: --wipe-games only clears games and their persisted events. Saved decks are left intact.
`);
}

function readFlagValue(args: string[], index: number, flag: string): string {
  const current = args[index] || '';
  const eqIndex = current.indexOf('=');
  if (eqIndex >= 0) {
    return current.slice(eqIndex + 1);
  }

  const next = args[index + 1];
  if (!next || next.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return next;
}

function resolveStartupOptions(args: string[]): StartupOptions {
  let port = Number(process.env.PORT || 3001);
  let corsOrigin = process.env.CORS_ORIGIN || '*';
  let clearPlaneswalkerCacheOnStartup = readBooleanEnv('CLEAR_PLANESWALKER_CACHE');
  let wipeGamesOnStartup = readBooleanEnv('WIPE_GAMES_ON_STARTUP');
  let showHelp = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    if (arg === '--help') {
      showHelp = true;
      continue;
    }

    if (arg === '--clear-planeswalker-cache') {
      clearPlaneswalkerCacheOnStartup = true;
      process.env.CLEAR_PLANESWALKER_CACHE = 'true';
      continue;
    }

    if (arg === '--wipe-games' || arg === '--wipe-games-on-startup') {
      wipeGamesOnStartup = true;
      process.env.WIPE_GAMES_ON_STARTUP = 'true';
      continue;
    }

    if (arg.startsWith('--port')) {
      const raw = readFlagValue(args, index, '--port');
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid value for --port: ${raw}`);
      }
      port = parsed;
      process.env.PORT = String(parsed);
      if (!arg.includes('=')) index++;
      continue;
    }

    if (arg.startsWith('--cors-origin')) {
      corsOrigin = readFlagValue(args, index, '--cors-origin');
      process.env.CORS_ORIGIN = corsOrigin;
      if (!arg.includes('=')) index++;
      continue;
    }

    if (arg.startsWith('--sqlite-file') || arg.startsWith('--sqlite-path')) {
      const sqliteFile = readFlagValue(args, index, arg.startsWith('--sqlite-path') ? '--sqlite-path' : '--sqlite-file');
      process.env.SQLITE_FILE = sqliteFile;
      process.env.SQLITE_PATH = sqliteFile;
      if (!arg.includes('=')) index++;
      continue;
    }

    if (arg.startsWith('--debug-state')) {
      const debugState = readFlagValue(args, index, '--debug-state');
      process.env.DEBUG_STATE = debugState;
      if (!arg.includes('=')) index++;
      continue;
    }

    throw new Error(`Unknown startup flag: ${arg}`);
  }

  return {
    port,
    corsOrigin,
    clearPlaneswalkerCache: clearPlaneswalkerCacheOnStartup,
    wipeGamesOnStartup,
    showHelp,
  };
}

const startupOptions = resolveStartupOptions(process.argv.slice(2));
if (startupOptions.showHelp) {
  printStartupHelp();
  process.exit(0);
}

function wipeGamesAtStartup(): { requested: number; deleted: number; ids: string[] } {
  const persisted = dbListGames();
  const ids = persisted.map((row) => String(row.game_id)).filter(Boolean);

  GameManager.clearAllGames();
  socketGames.clear();
  for (const timer of priorityTimers.values()) {
    clearTimeout(timer);
  }
  priorityTimers.clear();

  let deleted = 0;
  for (const id of ids) {
    try {
      if (dbDeleteGame(id)) {
        deleted++;
      }
    } catch (err) {
      debugWarn(1, `[Server] Failed to wipe game on startup: ${id}`, err);
    }
  }

  return { requested: ids.length, deleted, ids };
}

// Key configurations
// Updated default port to 3001 to match repository config defaults (can be overridden with PORT env var)
const PORT = startupOptions.port;
const BUILD_PATH = path.resolve(__dirname, "../../client/dist");

// Initialize Express app
const app = express();

// Serve static files from `client/dist`
app.use(express.static(BUILD_PATH));

// Simple JSON middleware for admin endpoints
app.use(express.json());

// API: list games (merged view between persisted metadata and in-memory state)
app.get("/api/games", (req, res) => {
  // Prevent caching to ensure fresh data (especially through reverse proxies like IIS/ARR)
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  });
  try {
    const persisted = dbListGames();
    const enriched = persisted.map((row) => {
      const id = row.game_id;
      const inMem = GameManager.getGame(id);
      const playersCount = inMem
        ? inMem.state && Array.isArray(inMem.state.players)
          ? inMem.state.players.length
          : 0
        : 0;
      const turn = inMem
        ? inMem.state && typeof inMem.state.turn !== "undefined"
          ? inMem.state.turn
          : null
        : null;
      const phase = inMem
        ? inMem.state && typeof inMem.state.phase !== "undefined"
          ? inMem.state.phase
          : null
        : null;
      const status = inMem
        ? inMem.state && typeof inMem.state.status !== "undefined"
          ? inMem.state.status
          : null
        : null;
      // Get count of active socket connections for this game
      // This allows the client to show delete button when no players are connected
      const activeConnectionsCount = GameManager.getActiveConnectionsCount(id);
      return {
        id,
        format: row.format,
        startingLife: row.starting_life,
        createdAt: row.created_at,
        createdByPlayerId: row.created_by_player_id || null,
        playersCount,
        activeConnectionsCount,
        turn,
        phase,
        status,
      };
    });
    res.json({ games: enriched });
  } catch (err) {
    debugError(1, "GET /api/games failed:", err);
    res.status(500).json({ error: "Failed to list games" });
  }
});

// API: list saved decks (for AI opponent deck selection)
app.get("/api/decks", (req, res) => {
  try {
    const decks = listDecks();
    res.json({ decks });
  } catch (err) {
    debugError(1, "GET /api/decks failed:", err);
    res.status(500).json({ error: "Failed to list decks" });
  }
});

// API: save a deck (for AI opponent deck import)
app.post("/api/decks", (req, res) => {
  try {
    const { name, text } = req.body;
    
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: "Deck name is required" });
      return;
    }
    
    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: "Deck text is required" });
      return;
    }
    
    // Use the shared parseDecklist function for consistent parsing
    let cardCount = 0;
    try {
      const parsed = parseDecklist(text);
      cardCount = parsed.reduce((sum, entry) => sum + (entry.count || 1), 0);
    } catch (e) {
      debugWarn(1, "[API] parseDecklist failed, using fallback count:", e);
      // Fallback: simple line count
      cardCount = text.split(/\r?\n/).filter((l: string) => l.trim().length > 0).length;
    }
    
    const deckId = `deck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    saveDeck({
      id: deckId,
      name: name.trim(),
      text: text.trim(),
      created_by_id: 'api',
      created_by_name: 'API Import',
      card_count: cardCount,
    });
    
    debug(1, "[API] Deck saved:", { deckId, name: name.trim(), cardCount });
    
    res.json({ success: true, deckId, cardCount });
  } catch (err) {
    debugError(1, "POST /api/decks failed:", err);
    res.status(500).json({ error: "Failed to save deck" });
  }
});

// API: submit a house rule suggestion
app.post("/api/house-rule-suggestions", (req, res) => {
  try {
    const { suggestion } = req.body;
    
    if (!suggestion || typeof suggestion !== 'string' || !suggestion.trim()) {
      res.status(400).json({ error: "Suggestion text is required" });
      return;
    }
    
    // Limit suggestion length to prevent abuse
    if (suggestion.length > 2000) {
      res.status(400).json({ error: "Suggestion too long (max 2000 characters)" });
      return;
    }
    
    const saved = addSuggestion(suggestion.trim());
    
    debug(1, "[API] House rule suggestion submitted:", saved.id);
    
    res.json({ success: true, suggestionId: saved.id });
  } catch (err) {
    debugError(1, "POST /api/house-rule-suggestions failed:", err);
    res.status(500).json({ error: "Failed to save suggestion" });
  }
});

// API: list house rule suggestions (admin only - localhost)
app.get("/api/house-rule-suggestions", (req, res) => {
  try {
    // Determine requester IP (works for direct connections)
    const remote = (req.ip || req.socket.remoteAddress || "").toString();
    const allowed =
      remote === "127.0.0.1" ||
      remote === "::1" ||
      remote === "localhost" ||
      remote === "127.0.0.1:3001";
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    
    const suggestions = loadSuggestions();
    res.json({ suggestions });
  } catch (err) {
    debugError(1, "GET /api/house-rule-suggestions failed:", err);
    res.status(500).json({ error: "Failed to list suggestions" });
  }
});

// Admin: delete a game (only from localhost)
app.delete("/admin/games/:id", (req, res) => {
  try {
    // Determine requester IP (works for direct connections). If behind proxy, adjust trust proxy as needed.
    const remote = (req.ip || req.socket.remoteAddress || "").toString();
    const allowed =
      remote === "127.0.0.1" ||
      remote === "::1" ||
      remote === "localhost" ||
      remote === "127.0.0.1:3001";
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const id = String(req.params.id || "");
    if (!id) {
      res.status(400).json({ error: "Missing game id" });
      return;
    }

    // Remove in-memory game from GameManager (authoritative)
    try {
      const removed = GameManager.deleteGame(id);
      if (!removed) {
        debug(1, 
          `DELETE /admin/games/${id}: GameManager.deleteGame returned false (no in-memory game)`
        );
      } else {
        debug(1, 
          `DELETE /admin/games/${id}: GameManager.deleteGame removed in-memory game`
        );
      }
    } catch (e) {
      debugWarn(1, 
        `DELETE /admin/games/${id}: GameManager.deleteGame threw`,
        e
      );
    }

    // Remove persisted rows (events + games metadata)
    const ok = dbDeleteGame(id);
    if (!ok) {
      debugWarn(2, `DELETE /admin/games/${id}: deleteGame returned false`);
    }

    res.json({ ok: true });
  } catch (err) {
    debugError(1, "DELETE /admin/games/:id failed:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// Admin: delete ALL games (only from localhost)
app.delete("/admin/games", (req, res) => {
  try {
    const remote = (req.ip || req.socket.remoteAddress || "").toString();
    const allowed =
      remote === "127.0.0.1" ||
      remote === "::1" ||
      remote === "localhost" ||
      remote === "127.0.0.1:3001";
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const persisted = dbListGames();
    const ids = persisted.map((r) => String(r.game_id)).filter(Boolean);

    let deleted = 0;
    for (const id of ids) {
      try {
        GameManager.deleteGame(id);
      } catch {
        // best-effort
      }
      try {
        const ok = dbDeleteGame(id);
        if (ok) deleted++;
      } catch (e) {
        debugWarn(1, `DELETE /admin/games: dbDeleteGame threw for ${id}`, e);
      }
    }

    res.json({ ok: true, requested: ids.length, deleted, ids });
  } catch (err) {
    debugError(1, "DELETE /admin/games failed:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// Handle undefined routes by serving `index.html` (useful for React Router handling)
app.get("*", (req, res) => {
  res.sendFile(path.join(BUILD_PATH, "index.html"), (err) => {
    if (err) {
      debugError(1, `Error serving index.html: ${err.message}`);
      res
        .status(500)
        .send(
          "Static files missing. Ensure `npm run build` was run in the client directory."
        );
    }
  });
});

// Main bootstrap: initialize DB first, then create HTTP + Socket.IO servers and register handlers.
async function main() {
  try {
    debug(1, "[Server] Boot", { bootId: BOOT_ID, pid: process.pid, node: process.version, port: PORT });
    debug(2, "[Server] Initializing database...");
    await initDb();
    debug(2, "[Server] Database initialized successfully.");

    if (startupOptions.wipeGamesOnStartup) {
      const wipeResult = wipeGamesAtStartup();
      debug(1, "[Server] Wiped games at startup", wipeResult);
    }
    
    // Optionally clear planeswalker cache to force re-fetch with loyalty field
    // Set environment variable CLEAR_PLANESWALKER_CACHE=true to enable on startup
    // This is useful after adding new fields like loyalty to the ScryfallCard type
    if (startupOptions.clearPlaneswalkerCache) {
      clearPlaneswalkerCache();
    }
  } catch (err) {
    debugError(1, "[Server] Failed to initialize database:", err);
    process.exit(1); // Stop the server if the database cannot be initialized
  }

  // Create HTTP and WebSocket server after DB initialization to avoid races when handlers persist/read DB.
  const httpServer = createServer(app);

  // Allow configuring CORS origin via env var in production; default is '*' for dev
  const corsOrigin = startupOptions.corsOrigin;

  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
    },
  });

  // Register Socket.IO handlers
  registerSocketHandlers(io);

  // Start the server bound to localhost only for security (IIS/ARR will reverse-proxy to this)
  httpServer.listen(PORT, "127.0.0.1", () => {
    debug(2, `[Server] Running at http://127.0.0.1:${PORT}`);
    
    // Initialize CLI interface for server management
    setHttpServer(httpServer);
    initCLI();
  });
}

main().catch((err) => {
  debugError(1, "[Server] Unhandled error during startup:", err);
  process.exit(1);
});

