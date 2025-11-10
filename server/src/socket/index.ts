import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from "../../shared/src";

import { registerJoinHandlers } from "./join";
import { registerGameActions } from "./game-actions";
import { registerCommanderHandlers } from "./commander";
import { registerDeckHandlers } from "./deck";
import { registerInteractionHandlers } from "./interaction";
import { registerPriorityHandlers } from "./priority";
import { registerDisconnectHandlers } from "./disconnect";

/**
 * Registers all Socket.IO event handlers for the server,
 * coordinating modular handlers into a unified workflow.
 */
export function registerSocketHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
) {
  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Register modular event handlers
    registerJoinHandlers(io, socket);
    registerGameActions(io, socket);
    registerCommanderHandlers(io, socket);
    registerDeckHandlers(io, socket);
    registerInteractionHandlers(io, socket);
    registerPriorityHandlers(io, socket);
    registerDisconnectHandlers(io, socket);

    // Log disconnection reason
    socket.on("disconnect", (reason) => {
      console.log(`Socket disconnected: ${socket.id}. Reason: ${reason}`);
    });
  });
}