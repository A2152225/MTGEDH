import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from "../../../shared/src";
import { deleteGame as deleteGameFromDb, isGameCreator } from "../db";
import GameManager from "../GameManager";
import { games, priorityTimers } from "./socket";

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
  // Now allows game creators to delete their own games, OR anyone if no players are connected
  // Also accepts optional claimedPlayerId for cases where socket hasn't joined a game yet
  // but the client knows their player ID from localStorage/session
  //
  // SECURITY NOTE: The claimedPlayerId parameter is client-provided and therefore untrusted.
  // It is validated against the server's database record (isGameCreator check) before any action.
  // An attacker cannot delete games they don't own because isGameCreator verifies that the
  // claimedPlayerId matches the game's stored created_by_player_id field in the database.
  // The only fallback is noActivePlayers, which allows anyone to clean up abandoned games.
  socket.on("deleteGame", ({ gameId, claimedPlayerId }: { gameId: string; claimedPlayerId?: string }) => {
    try {
      if (!gameId || typeof gameId !== "string") {
        socket.emit("error", {
          code: "DELETE_GAME_MISSING_ID",
          message: "gameId required.",
        });
        return;
      }

      // Get the player ID of the requesting socket, or use the claimed player ID
      // Priority: socket.data.playerId (if user is currently in a game) > claimedPlayerId (from localStorage)
      // Note: Both values are ultimately validated against the database in isGameCreator()
      const playerId = socket.data?.playerId || claimedPlayerId;
      
      // Check if the player is the creator of the game (validated against DB record)
      const isCreator = playerId ? isGameCreator(gameId, playerId) : false;
      
      // Check if there are any active (non-spectator) players connected to the game
      // Use Socket.IO's room adapter to get all sockets in the game room
      const room = io.sockets.adapter.rooms.get(gameId);
      let activePlayerCount = 0;
      if (room) {
        for (const socketId of room) {
          const s = io.sockets.sockets.get(socketId);
          // Only count non-spectator players
          if (s && s.data.playerId && !s.data.spectator) {
            activePlayerCount++;
          }
        }
      }
      const noActivePlayers = activePlayerCount === 0;
      
      console.info("[socket] deleteGame requested", {
        gameId,
        bySocket: socket.id,
        socketPlayerId: socket.data?.playerId,
        claimedPlayerId,
        resolvedPlayerId: playerId,
        isCreator,
        activePlayerCount,
        noActivePlayers,
      });

      // Allow delete if: player is creator, OR no active players are connected
      if (!isCreator && !noActivePlayers) {
        socket.emit("error", {
          code: "DELETE_GAME_NOT_AUTHORIZED",
          message: "Only the game creator can delete this game, or you can delete it if no players are connected.",
        });
        return;
      }

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
      // Note: deleteGameFromDb returns false if no row existed, but that's not an error
      // The in-memory game was already removed above, so we should still consider this a success
      try {
        const dbOk = deleteGameFromDb(gameId);
        console.info("[socket] deleteGameFromDb", { gameId, dbOk });
        // dbOk is false if no DB row existed - this is fine, game may have been in-memory only
      } catch (e) {
        // Log but don't fail the entire delete operation - in-memory game is already removed
        console.error("[socket] deleteGameFromDb threw (continuing)", {
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
}
