import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, schedulePriorityTimeout } from "./util";
import { appendEvent } from "../db";
import { computeDiff } from "../utils/diff";
import { games } from "./socket";

export function registerJoinHandlers(io: Server, socket: Socket) {
  // Join a game
  socket.on("joinGame", async ({ gameId, playerName, spectator, seatToken }) => {
    try {
      // Ensure the game exists
      const game = ensureGame(gameId);

      if (!game.hasRngSeed()) {
        const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
        game.seedRng(seed);
        await appendEvent(gameId, game.seq, "rngSeed", { seed });
      }

      const { playerId, added, seatToken: resolvedToken } = game.join(
        socket.id,
        playerName,
        Boolean(spectator),
        undefined,
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
    } catch (err) {
      console.error(`joinGame error for socket ${socket.id}:`, err);
      socket.emit("error", { code: "JOIN_ERROR", message: err.message });
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