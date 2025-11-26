import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  GameID,
} from "../../../shared/src";
import type { InMemoryGame } from "../state/types";
import { registerJoinHandlers } from "./join";
import { registerGameActions } from "./game-actions";
import { registerCommanderHandlers } from "./commander";
import { registerDeckHandlers } from "./deck";
import { registerInteractionHandlers } from "./interaction";
import { registerDisconnectHandlers } from "./disconnect";

// NEW: import DB delete + GameManager delete
import { deleteGame as deleteGameFromDb } from "../db";
import GameManager from "../GameManager";

// Shared globals
export const games = new Map<GameID, InMemoryGame>();
export const priorityTimers = new Map<GameID, NodeJS.Timeout>();
export const PRIORITY_TIMEOUT_MS = 30_000;

// Register all socket handlers
type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export function registerSocketHandlers(io: TypedServer) {
  io.on("connection", (socket: Socket) => {
    registerJoinHandlers(io, socket);
    registerGameActions(io, socket);
    registerCommanderHandlers(io, socket);
    registerDeckHandlers(io, socket);
    registerInteractionHandlers(io, socket);
    registerDisconnectHandlers(io, socket);

    // --- deleteGame: hard wipe game state + events so gameId can be reused cleanly ---
    socket.on("deleteGame", ({ gameId }: { gameId: string }) => {
      try {
        if (!gameId || typeof gameId !== "string") {
          socket.emit("error", {
            code: "DELETE_GAME_MISSING_ID",
            message: "gameId required.",
          });
          return;
        }

        console.info("[socket] deleteGame requested", {
          gameId,
          bySocket: socket.id,
        });

        // Remove from GameManager (authoritative in-memory games map)
        try {
          const removed = GameManager.deleteGame(gameId);
          console.info("[socket] GameManager.deleteGame", {
            gameId,
            removed,
          });
        } catch (e) {
          console.warn("[socket] GameManager.deleteGame failed", {
            gameId,
            error: (e as Error).message,
          });
        }

        // Also remove from legacy games Map if used anywhere
        try {
          const hadLegacy = games.delete(gameId as any);
          if (hadLegacy) {
            console.info("[socket] legacy games Map delete", { gameId });
          }
        } catch (e) {
          console.warn("[socket] legacy games Map delete failed", {
            gameId,
            error: (e as Error).message,
          });
        }

        // Delete persisted events + game metadata
        let dbOk = false;
        try {
          dbOk = deleteGameFromDb(gameId);
          console.info("[socket] deleteGameFromDb", { gameId, dbOk });
        } catch (e) {
          console.error("[socket] deleteGameFromDb threw", {
            gameId,
            error: (e as Error).message,
          });
        }

        if (!dbOk) {
          socket.emit("error", {
            code: "DELETE_GAME_DB_ERROR",
            message: "Failed to delete game data from storage.",
          });
          return;
        }

        // Clear any priority timers tied to this game
        try {
          const t = priorityTimers.get(gameId as any);
          if (t) {
            clearTimeout(t);
            priorityTimers.delete(gameId as any);
          }
        } catch (e) {
          console.warn("[socket] deleteGame: clearing priority timer failed", {
            gameId,
            error: (e as Error).message,
          });
        }

        // Notify caller + others that the game is gone
        socket.emit("gameDeletedAck", { gameId });
        socket.broadcast.emit("gameDeleted", { gameId });
      } catch (err) {
        console.error("[socket] deleteGame handler failed", err);
        try {
          socket.emit("error", {
            code: "DELETE_GAME_FAILED",
            message: "Failed to delete game.",
          });
        } catch {
          // ignore
        }
      }
    });
  });
}