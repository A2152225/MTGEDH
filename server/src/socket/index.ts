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
// Player selection is handled via the Resolution Queue (ResolutionStepType.PLAYER_CHOICE)
import { registerCombatHandlers } from "./combat.js";
import { registerTriggerHandlers } from "./triggers.js";
import { registerOpeningHandHandlers } from "./opening-hand.js";
import { registerUndoHandlers } from "./undo.js";
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

    // Defense-in-depth: once a socket is associated with a gameId,
    // reject any incoming event that targets a different gameId or a room
    // the socket is not currently joined to.
    // This does NOT replace per-handler authorization checks; it narrows the
    // attack surface for missed checks.
    try {
      socket.use((packet: any[], next) => {
        try {
          const eventName = packet?.[0];
          const payload = packet?.[1];

          // Some events intentionally run before room join / without a room.
          // Keep this list small and security-reviewed.
          const allowWithoutRoom = new Set<string>([
            "joinGame",
            "deleteGame",
            "createGame",
            "createGameWithAI",
            "createGameWithMultipleAI",
          ]);

          const payloadGameId =
            payload && typeof payload === "object" ? (payload as any).gameId : undefined;

          // If the payload has no gameId, we can't validate here.
          const socketGameId = (socket.data as any)?.gameId as string | undefined;

          // If there is no gameId in the payload, we can't validate here.
          if (!payloadGameId || typeof payloadGameId !== "string") return next();

          // If the socket is already associated with a game, never allow cross-game messages.
          if (socketGameId && payloadGameId !== socketGameId) {
            try {
              socket.emit?.("error", {
                code: "NOT_IN_GAME",
                message: "Not in game.",
              } as any);
            } catch {
              // ignore
            }
            return next(new Error("NOT_IN_GAME"));
          }

          const inRoom = !!(socket as any)?.rooms?.has?.(payloadGameId);

          // Allowlisted events may run without room membership, but are still bound
          // to the socket's current gameId (enforced above).
          if (allowWithoutRoom.has(String(eventName || ""))) return next();

          // If the socket is already associated with a game, enforce same-game + in-room.
          if (socketGameId) {
            if (payloadGameId !== socketGameId || !inRoom) {
              try {
                socket.emit?.("error", {
                  code: "NOT_IN_GAME",
                  message: "Not in game.",
                } as any);
              } catch {
                // ignore
              }
              return next(new Error("NOT_IN_GAME"));
            }
            return next();
          }

          // If the socket is not yet associated with a game, still require room membership
          // for any game-scoped event.
          if (!inRoom) {
            try {
              socket.emit?.("error", {
                code: "NOT_IN_GAME",
                message: "Not in game.",
              } as any);
            } catch {
              // ignore
            }
            return next(new Error("NOT_IN_GAME"));
          }

          return next();
        } catch {
          return next();
        }
      });
    } catch {
      // ignore middleware setup errors
    }

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
    registerCombatHandlers(io, socket);
    registerTriggerHandlers(io, socket);
    registerOpeningHandHandlers(io, socket);
    registerUndoHandlers(io, socket);
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
