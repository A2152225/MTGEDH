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
import { registerCreatureTypeHandlers } from "./creature-type.js";
import { registerColorChoiceHandlers } from "./color-choice.js";
import { registerPlayerSelectionHandlers } from "./player-selection.js";
import { registerCombatHandlers } from "./combat.js";
import { registerTriggerHandlers } from "./triggers.js";
import { registerOpeningHandHandlers } from "./opening-hand.js";
import { registerUndoHandlers } from "./undo.js";
import { registerJoinForcesHandlers } from "./join-forces.js";
import { registerAutomationHandlers } from "./automation.js";
import { registerGameManagementHandlers } from "./game-management.js";
import { registerRandomnessHandlers } from "./randomness.js";
import { registerReplayHandlers } from "./replay.js";
import { registerOpponentMayPayHandlers } from "./opponent-may-pay.js";
import { registerResolutionHandlers, initializeAIResolutionHandler, initializePriorityResolutionHandler } from "./resolution.js";
import { GameManager } from "../GameManager.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";

/**
 * Registers all Socket.IO event handlers for the server,
 * coordinating modular handlers into a unified workflow.
 */
export function registerSocketHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
) {
  // Set the IO server instance in GameManager for RulesBridge integration
  (GameManager as any).setIOServer(io);
  debug(2, '[Socket] GameManager configured with IO server for rules engine integration');

  // Initialize global resolution handlers (once per server)
  initializeAIResolutionHandler(io);
  initializePriorityResolutionHandler(io);

  io.on("connection", (socket) => {
    debug(2, `Socket connected: ${socket.id}`);

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
    registerCreatureTypeHandlers(io, socket);
    registerColorChoiceHandlers(io, socket);
    registerPlayerSelectionHandlers(io, socket);
    registerCombatHandlers(io, socket);
    registerTriggerHandlers(io, socket);
    registerOpeningHandHandlers(io, socket);
    registerUndoHandlers(io, socket);
    registerJoinForcesHandlers(io, socket);
    registerAutomationHandlers(io, socket);
    registerGameManagementHandlers(io, socket);
    registerRandomnessHandlers(io, socket);
    registerReplayHandlers(io, socket);
    registerOpponentMayPayHandlers(io, socket);
    registerResolutionHandlers(io, socket);

    // Log disconnection reason
    socket.on("disconnect", (reason) => {
      debug(1, `Socket disconnected: ${socket.id}. Reason: ${reason}`);
    });
  });
}
