import { createServer } from "http";
import { Server } from "socket.io";
import express from "express";
import { registerSocketHandlers } from "./socket";
import { initDb } from "./db"; // Ensure db initialization
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from "../shared/src";

// Initialize Express application
const app = express();
const port = 3000;

// Serve static files (React frontend build or public assets)
app.use(express.static("public"));

// Initialize the SQLite database during server startup
(async function initializeDatabase() {
  try {
    await initDb(); // Call the DB initialization method
    console.log("Database initialized successfully.");
  } catch (err) {
    console.error("Failed to initialize database:", err);
    process.exit(1); // Stop the server if DB is not ready
  }
})();

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO server
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  httpServer,
  {
    cors: {
      origin: "*", // Update this in production for restricted origins
      methods: ["GET", "POST"],
    },
  }
);

// Log Socket.IO events (connection & disconnection)
io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  socket.on("disconnect", (reason) => {
    console.log(`Socket disconnected: ${socket.id}. Reason: ${reason}`);
  });
});

// Register all socket event handlers from the modular /socket directory
registerSocketHandlers(io);

// Start the server
httpServer.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});