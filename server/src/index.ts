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
const PORT = Number(process.env.PORT || 3000);
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

// Initialize the SQLite database
(async () => {
  try {
    console.log("[Server] Initializing database...");
    await initDb();
    console.log("[Server] Database initialized successfully.");
  } catch (err) {
    console.error("[Server] Failed to initialize database:", err);
    process.exit(1); // Stop the server if the database cannot be initialized
  }
})();

// Create HTTP and WebSocket server
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  httpServer,
  {
    cors: {
      origin: "*", // Update this for production if needed
      methods: ["GET", "POST"],
    },
  }
);

// Register Socket.IO handlers
registerSocketHandlers(io);

// Start the server
httpServer.listen(PORT, () => {
  console.log(`[Server] Running at http://localhost:${PORT}`);
});