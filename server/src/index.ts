import { createServer } from "http";
import { Server } from "socket.io";
import express from "express";
import { registerSocketHandlers } from "./socket";
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

// Register all socket handlers from the modular /socket directory
registerSocketHandlers(io);

// Start the server
httpServer.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});