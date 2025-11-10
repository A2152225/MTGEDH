import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, appendGameEvent } from "./util";

export function registerGameActions(io: Server, socket: Socket) {
  socket.on("passPriority", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;

      if (!game || !playerId) return;

      const { changed, resolvedNow } = game.passPriority(playerId);
      if (!changed) return;

      appendGameEvent(game, gameId, "passPriority", { by: playerId });

      if (resolvedNow) {
        appendGameEvent(game, gameId, "resolveTopOfStack");
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: "Top of stack resolved.",
          ts: Date.now(),
        });
      }

      broadcastGame(io, game, gameId);
    } catch (err) {
      console.error(`passPriority error for game ${gameId}:`, err);
      socket.emit("error", { code: "PASS_PRIORITY_ERROR", message: err.message });
    }
  });

  socket.on("nextTurn", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;

      if (!game || !playerId) return;

      if (game.state.turnPlayer !== playerId) {
        socket.emit("error", { code: "NEXT_TURN", message: "Only the active player can advance the turn." });
        return;
      }

      if (game.state.stack.length > 0) {
        socket.emit("error", { code: "NEXT_TURN", message: "Cannot advance turn while the stack is not empty." });
        return;
      }

      game.nextTurn();
      appendGameEvent(game, gameId, "nextTurn");

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `Turn advanced. Active player: ${game.state.turnPlayer}`,
        ts: Date.now(),
      });

      broadcastGame(io, game, gameId);
    } catch (err) {
      console.error(`nextTurn error for game ${gameId}:`, err);
      socket.emit("error", { code: "NEXT_TURN_ERROR", message: err.message });
    }
  });
}