import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
// registerSocketHandlers comes from the socket index (folder)
// games Map is exported from socket/socket.ts — import it directly
import { registerSocketHandlers } from "./socket";
import { games as socketGames } from "./socket/socket";
import {
  initDb,
  listGames as dbListGames,
  deleteGame as dbDeleteGame,
} from "./db";
import { listDecks, saveDeck } from "./db/decks";
import { addSuggestion, loadSuggestions } from "./db/houseRuleSuggestions";
import { parseDecklist, clearPlaneswalkerCache } from "./services/scryfall";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from "../../shared/src/events";
import GameManager from "./GameManager.js"; // NEW: import GameManager
import { initCLI, setHttpServer } from "./cli"; // CLI support for server management
import { debug, debugWarn, debugError } from "./utils/debug.js";
import { BOOT_ID } from "./utils/bootId.js";

// Get the equivalent of __dirname in ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Key configurations
// Updated default port to 3001 to match repository config defaults (can be overridden with PORT env var)
const PORT = Number(process.env.PORT || 3001);
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
      const inMem = socketGames.get(id);
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

    // Remove in-memory game from legacy socketGames Map if present
    try {
      const hadLegacy = socketGames.delete(id);
      if (hadLegacy) {
        debug(1, 
          `DELETE /admin/games/${id}: removed from socketGames legacy map`
        );
      }
    } catch (e) {
      debugWarn(1, "Failed to remove in-memory game from socketGames:", e);
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
    
    // Optionally clear planeswalker cache to force re-fetch with loyalty field
    // Set environment variable CLEAR_PLANESWALKER_CACHE=true to enable on startup
    // This is useful after adding new fields like loyalty to the ScryfallCard type
    clearPlaneswalkerCache();
  } catch (err) {
    debugError(1, "[Server] Failed to initialize database:", err);
    process.exit(1); // Stop the server if the database cannot be initialized
  }

  // Create HTTP and WebSocket server after DB initialization to avoid races when handlers persist/read DB.
  const httpServer = createServer(app);

  // Allow configuring CORS origin via env var in production; default is '*' for dev
  const corsOrigin = process.env.CORS_ORIGIN || "*";

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

