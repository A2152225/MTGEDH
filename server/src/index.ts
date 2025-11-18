import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { registerSocketHandlers } from "./socket";
import { initDb } from "./db";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from "../../shared/src/events";

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

// Handle undefined routes by serving `index.html` (useful for React Router handling)
app.get("*", (req, res) => {
  res.sendFile(path.join(BUILD_PATH, "index.html"), (err) => {
    if (err) {
      console.error(`Error serving index.html: ${err.message}`);
      res.status(500).send("Static files missing. Ensure `npm run build` was run in the client directory.");
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

  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    httpServer,
    {
      cors: {
        origin: corsOrigin,
        methods: ["GET", "POST"],
      },
    }
  );

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