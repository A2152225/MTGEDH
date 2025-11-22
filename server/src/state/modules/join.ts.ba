import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, schedulePriorityTimeout } from "./util";
import { appendEvent } from "../db";
import { computeDiff } from "../utils/diff";
import { games } from "./socket";

/**
 * Register join handlers.
 * If a connecting player name is already in use by a currently connected player,
 * emit "nameInUse" with options so the client can present:
 *   - { action: 'reconnect', fixedPlayerId }
 *   - { action: 'newName' }
 *   - { action: 'cancel' }
 *
 * Client flow:
 *  - On 'reconnect' the client should call joinGame again with fixedPlayerId set.
 *  - On 'newName' the client should prompt for a new name and call joinGame again.
 */
export function registerJoinHandlers(io: Server, socket: Socket) {
  // Join a game
  socket.on("joinGame", async ({ gameId, playerName, spectator, seatToken, fixedPlayerId }) => {
    try {
      // Ensure the game exists
      const game = ensureGame(gameId);

      // If a non-empty playerName is provided and no fixedPlayerId was provided,
      // check for an existing player with that name who is already connected.
      if (!fixedPlayerId && playerName) {
        const existing = (game.state && Array.isArray(game.state.players))
          ? (game.state.players as any[]).find((p) => String(p?.name || "").trim().toLowerCase() === String(playerName).trim().toLowerCase())
          : undefined;

        if (existing && existing.id) {
          // is this player currently connected according to participants?
          const participants = typeof (game as any).participants === "function" ? (game as any).participants() : ((game as any).participantsList || []);
          const isConnected = participants.some((pp: any) => pp.playerId === existing.id);

          if (isConnected) {
            // Tell the connecting socket that the name is currently in use.
            // Provide fixedPlayerId so the client may choose "Reconnect".
            socket.emit("nameInUse", {
              gameId,
              playerName,
              options: [
                { action: "reconnect", fixedPlayerId: existing.id },
                { action: "newName" },
                { action: "cancel" },
              ],
            });
            return;
          }
        }
      }

      if (!game.hasRngSeed()) {
        const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
        game.seedRng(seed);
        await appendEvent(gameId, game.seq, "rngSeed", { seed });
      }

      const { playerId, added, seatToken: resolvedToken } = game.join(
        socket.id,
        playerName,
        Boolean(spectator),
        fixedPlayerId,
        seatToken
      );

      // Attach session metadata
      socket.data = { gameId, playerId, spectator };
      socket.join(gameId);

      // Emit initial view to the client
      const view = game.viewFor(playerId, Boolean(spectator));
      socket.emit("joined", { gameId, you: playerId, seatToken: resolvedToken });
      socket.emit("state", { gameId, view, seq: game.seq });

      if (!spectator && added) {
        try {
          await appendEvent(gameId, game.seq, "join", {
            playerId,
            name: playerName,
            seat: view.players.find((p) => p.id === playerId)?.seat,
            seatToken: resolvedToken,
          });

          socket.to(gameId).emit("stateDiff", {
            gameId,
            diff: computeDiff(undefined, view, game.seq),
          });

          schedulePriorityTimeout(io, game, gameId);
        } catch (dbError) {
          console.error(`joinGame database error for game ${gameId}:`, dbError);
          socket.emit("error", {
            code: "DB_ERROR",
            message: "Failed to log the player join event. Please reconnect.",
          });
          return;
        }
      }
    } catch (err: any) {
      console.error(`joinGame error for socket ${socket.id}:`, err);
      socket.emit("error", { code: "JOIN_ERROR", message: err?.message || String(err) });
    }
  });

  // Request state refresh
  socket.on("requestState", ({ gameId }) => {
    const game = games.get(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    const view = game.viewFor(playerId, Boolean(socket.data.spectator));
    socket.emit("state", { gameId, view, seq: game.seq });
    schedulePriorityTimeout(io, game, gameId);
  });
}