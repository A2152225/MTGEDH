import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, appendGameEvent } from "./util";
import { appendEvent } from "../db";

export function registerGameActions(io: Server, socket: Socket) {
  socket.on("passPriority", ({ gameId }) => {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    const { changed, resolvedNow } = game.passPriority(playerId);
    if (!changed) return;

    appendEvent(gameId, game.seq, "passPriority", { by: playerId });

    if (resolvedNow) {
      game.applyEvent({ type: "resolveTopOfStack" });
      appendGameEvent(game, gameId, "resolveTopOfStack");
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: "Resolved top of stack.",
        ts: Date.now(),
      });
    }

    broadcastGame(io, game, gameId);
  });

  socket.on("nextTurn", ({ gameId }) => {
    // Implement turn advancement logic
  });

  socket.on("nextStep", ({ gameId }) => {
    // Implement step advancement logic
  });
}