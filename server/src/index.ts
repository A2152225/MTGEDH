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
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from "../../shared/src/events";
import GameManager from "./GameManager"; // NEW: import GameManager

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
      return {
        id,
        format: row.format,
        startingLife: row.starting_life,
        createdAt: row.created_at,
        playersCount,
        turn,
        phase,
        status,
      };
    });
    res.json({ games: enriched });
  } catch (err) {
    console.error("GET /api/games failed:", err);
    res.status(500).json({ error: "Failed to list games" });
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
        console.info(
          `DELETE /admin/games/${id}: GameManager.deleteGame returned false (no in-memory game)`
        );
      } else {
        console.info(
          `DELETE /admin/games/${id}: GameManager.deleteGame removed in-memory game`
        );
      }
    } catch (e) {
      console.warn(
        `DELETE /admin/games/${id}: GameManager.deleteGame threw`,
        e
      );
    }

    // Remove in-memory game from legacy socketGames Map if present
    try {
      const hadLegacy = socketGames.delete(id);
      if (hadLegacy) {
        console.info(
          `DELETE /admin/games/${id}: removed from socketGames legacy map`
        );
      }
    } catch (e) {
      console.warn("Failed to remove in-memory game from socketGames:", e);
    }

    // Remove persisted rows (events + games metadata)
    const ok = dbDeleteGame(id);
    if (!ok) {
      console.warn(`DELETE /admin/games/${id}: deleteGame returned false`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /admin/games/:id failed:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// Handle undefined routes by serving `index.html` (useful for React Router handling)
app.get("*", (req, res) => {
  res.sendFile(path.join(BUILD_PATH, "index.html"), (err) => {
    if (err) {
      console.error(`Error serving index.html: ${err.message}`);
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
    console.log("[Server] Initializing database...");
    await initDb();
    console.log("[Server] Database initialized successfully.");
  } catch (err) {
    console.error("[Server] Failed to initialize database:", err);
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
    console.log(`[Server] Running at http://127.0.0.1:${PORT}`);
  });
}

main().catch((err) => {
  console.error("[Server] Unhandled error during startup:", err);
  process.exit(1);
});