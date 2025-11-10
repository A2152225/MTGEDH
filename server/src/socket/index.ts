import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from "../../shared/src";

import { registerJoinHandlers } from "./join";
import { registerGameActions } from "./game-actions";
import { registerCommanderHandlers } from "./commander";
import { registerDeckHandlers } from "./deck";
import { registerInteractionHandlers } from "./interaction";
import { registerDisconnectHandlers } from "./disconnect";

// Aggregate and export all handler registrations
export function registerSocketHandlers(io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) {
  io.on("connection", (socket: Socket) => {
    // Register handlers from different modules
    registerJoinHandlers(io, socket);
    registerGameActions(io, socket);
    registerCommanderHandlers(io, socket);
    registerDeckHandlers(io, socket);
    registerInteractionHandlers(io, socket);
    registerDisconnectHandlers(io, socket);

    // Optionally log connections for debug purposes
    console.log(`Socket connected: ${socket.id}`);
    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
}