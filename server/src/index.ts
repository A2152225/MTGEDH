import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { initDb } from "./db";
import { registerSocketHandlers } from "./socket";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from "../../shared/src/events";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use 3001 by default so IIS/ARR can reverse-proxy to it;
// override with PORT env var if needed.
const PORT = Number(process.env.PORT || 3001);
const BUILD_PATH = path.resolve(__dirname, "../../client/dist");

const app = express();

// Serve static assets from the built client
app.use(express.static(BUILD_PATH));
app.use(express.json());

// OPTIONAL: health endpoint
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// If you want /api/games and /admin/games later, you can re-add them here
// once you export `games` from server/src/socket.ts.

// Fallback: for any unknown route, serve index.html (SPA routing)
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

// Main bootstrap
async function main() {
  try {
    console.log("[Server] Initializing database...");
    await initDb();
    console.log("[Server] Database initialized successfully.");
  } catch (err) {
    console.error("[Server] Failed to initialize database:", err);
    process.exit(1);
  }

  const httpServer = createServer(app);

  // In front of IIS/ARR, CORS here can usually be relaxed or restricted to the IIS host.
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

  // Register all the handlers defined in server/src/socket.ts (Take2 monolith)
  registerSocketHandlers(io);

  // Bind only to loopback; IIS/ARR will proxy from public endpoint to here
  httpServer.listen(PORT, "127.0.0.1", () => {
    console.log(`[Server] Running at http://127.0.0.1:${PORT}`);
  });
}

main().catch((err) => {
  console.error("[Server] Unhandled error during startup:", err);
  process.exit(1);
});