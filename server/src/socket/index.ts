import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from "../../../shared/src/index.js";

import { registerJoinHandlers } from "./join.js";
import { registerGameActions } from "./game-actions.js";
import { registerCommanderHandlers } from "./commander.js";
import { registerDeckHandlers } from "./deck.js";
import { registerInteractionHandlers } from "./interaction.js";
import { registerPriorityHandlers } from "./priority.js";
import { registerDisconnectHandlers } from "./disconnect.js";
import { registerJudgeHandlers } from "./judge.js";
import { registerAIHandlers } from "./ai.js";
import { GameManager } from "../GameManager.js";

/**
 * Registers all Socket.IO event handlers for the server,
 * coordinating modular handlers into a unified workflow.
 */
export function registerSocketHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
) {
  // Set the IO server instance in GameManager for RulesBridge integration
  (GameManager as any).setIOServer(io);
  console.log('[Socket] GameManager configured with IO server for rules engine integration');

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
	registerJudgeHandlers(io, socket);
    registerAIHandlers(io, socket);

    // Log disconnection reason
    socket.on("disconnect", (reason) => {
      console.log(`Socket disconnected: ${socket.id}. Reason: ${reason}`);
    });
  });
}