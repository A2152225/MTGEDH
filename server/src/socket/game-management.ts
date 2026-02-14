import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from "../../../shared/src/events.js";
import { deleteGame as deleteGameFromDb, isGameCreator } from "../db/index.js";
import GameManager from "../GameManager.js";
import { games, priorityTimers } from "./socket.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";

type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/**
 * Register game management handlers (e.g., deleteGame)
 */
export function registerGameManagementHandlers(io: TypedServer, socket: Socket) {
  // --- deleteGame: hard wipe game state + events so gameId can be reused cleanly ---
  // Allows game creators to delete their own games.
  // Also accepts optional claimedPlayerId for cases where socket hasn't joined a game yet
  // but the client knows their player ID from localStorage/session
  //
  // SECURITY NOTE: The claimedPlayerId parameter is client-provided and therefore untrusted.
  // It is validated against the server's database record (isGameCreator check) before any action.
  // An attacker cannot delete games they don't own because isGameCreator verifies that the
  // claimedPlayerId matches the game's stored created_by_player_id field in the database.
  socket.on("deleteGame", ({ gameId, claimedPlayerId }: { gameId: string; claimedPlayerId?: string }) => {
    try {
      if (!gameId || typeof gameId !== "string") {
        socket.emit("error", {
          code: "DELETE_GAME_MISSING_ID",
          message: "gameId required.",
        });
        return;
      }

      // If this socket is currently associated with a different game,
      // block cross-game deletes from that context.
      const socketGameId = (socket.data as any)?.gameId as string | undefined;
      if (socketGameId && socketGameId !== gameId) {
        socket.emit("error", {
          code: "NOT_IN_GAME",
          message: "Not in game.",
        } as any);
        return;
      }

      // Get the player ID of the requesting socket, or use the claimed player ID
      // Priority: socket.data.playerId (if user is currently in a game) > claimedPlayerId (from localStorage)
      // Note: Both values are ultimately validated against the database in isGameCreator()
      const playerId = socket.data?.playerId || claimedPlayerId;
      
      // Check if the player is the creator of the game (validated against DB record)
      const isCreator = playerId ? isGameCreator(gameId, playerId) : false;
      
      debug(1, "[socket] deleteGame requested", {
        gameId,
        bySocket: socket.id,
        socketPlayerId: socket.data?.playerId,
        claimedPlayerId,
        resolvedPlayerId: playerId,
        isCreator,
      });

      // Allow delete only for the creator (validated via DB).
      if (!isCreator) {
        socket.emit("error", {
          code: "DELETE_GAME_NOT_AUTHORIZED",
          message: "Only the game creator can delete this game.",
        });
        return;
      }

      // Remove from GameManager (authoritative in-memory games map)
      try {
        const removed = GameManager.deleteGame(gameId);
        debug(1, "[socket] GameManager.deleteGame", {
          gameId,
          removed,
        });
      } catch (e) {
        debugWarn(1, "[socket] GameManager.deleteGame failed", {
          gameId,
          error: (e as Error).message,
        });
      }

      // Also remove from legacy games Map if used anywhere
      try {
        const hadLegacy = games.delete(gameId as any);
        if (hadLegacy) {
          debug(1, "[socket] legacy games Map delete", { gameId });
        }
      } catch (e) {
        debugWarn(1, "[socket] legacy games Map delete failed", {
          gameId,
          error: (e as Error).message,
        });
      }

      // Delete persisted events + game metadata
      // Note: deleteGameFromDb returns false if no row existed, but that's not an error
      // The in-memory game was already removed above, so we should still consider this a success
      try {
        const dbOk = deleteGameFromDb(gameId);
        debug(1, "[socket] deleteGameFromDb", { gameId, dbOk });
        // dbOk is false if no DB row existed - this is fine, game may have been in-memory only
      } catch (e) {
        // Log but don't fail the entire delete operation - in-memory game is already removed
        debugError(1, "[socket] deleteGameFromDb threw (continuing)", {
          gameId,
          error: (e as Error).message,
        });
      }

      // Clear any priority timers tied to this game
      try {
        const t = priorityTimers.get(gameId as any);
        if (t) {
          clearTimeout(t);
          priorityTimers.delete(gameId as any);
        }
      } catch (e) {
        debugWarn(1, "[socket] deleteGame: clearing priority timer failed", {
          gameId,
          error: (e as Error).message,
        });
      }

      // Notify caller + others that the game is gone
      socket.emit("gameDeletedAck", { gameId });
      socket.broadcast.emit("gameDeleted", { gameId });
    } catch (err) {
      debugError(1, "[socket] deleteGame handler failed", err);
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
}


