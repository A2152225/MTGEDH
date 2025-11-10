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
  });

  socket.on("nextTurn", ({ gameId }) => {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;

    if (!game || !playerId) return;

    if (game.state.turnPlayer !== playerId) {
      socket.emit("error", { code: "TURN", message: "Only the active player can advance the turn" });
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
  });
}