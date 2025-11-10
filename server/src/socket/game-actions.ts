import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, appendGameEvent } from "./util";
import { appendEvent } from "../db";

export function registerGameActions(io: Server, socket: Socket) {
  // Pass priority
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

  // Next turn
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

  // Next step handler
  socket.on("nextStep", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      if (game.state.turnPlayer !== playerId) {
        socket.emit("error", { code: "NEXT_STEP", message: "Only the active player can advance the step." });
        return;
      }
      if (game.state.stack.length > 0) {
        socket.emit("error", { code: "NEXT_STEP", message: "Cannot advance step while the stack is not empty." });
        return;
      }

      game.nextStep();
      appendGameEvent(game, gameId, "nextStep");
      broadcastGame(io, game, gameId);
    } catch (err) {
      console.error(`nextStep error for game ${gameId}:`, err);
      socket.emit("error", { code: "NEXT_STEP_ERROR", message: err.message });
    }
  });

  // Set turn direction (+1 or -1)
  socket.on("setTurnDirection", ({ gameId, direction }: { gameId: string; direction: 1 | -1 }) => {
    try {
      const game = ensureGame(gameId);
      game.setTurnDirection(direction);
      appendGameEvent(game, gameId, "setTurnDirection", { direction });
      broadcastGame(io, game, gameId);
    } catch (err) {
      socket.emit("error", { code: "TURN_DIRECTION_ERROR", message: err.message });
    }
  });

  // Restart (keep roster/players)
  socket.on("restartGame", ({ gameId }) => {
    try {
      const game = ensureGame(gameId);
      game.reset(true);
      appendEvent(gameId, game.seq, "restart", { preservePlayers: true });
      broadcastGame(io, game, gameId);
    } catch (err) {
      socket.emit("error", { code: "RESTART_ERROR", message: err.message });
    }
  });

  // Restart (clear roster/players)
  socket.on("restartGameClear", ({ gameId }) => {
    try {
      const game = ensureGame(gameId);
      game.reset(false);
      appendEvent(gameId, game.seq, "restart", { preservePlayers: false });
      broadcastGame(io, game, gameId);
    } catch (err) {
      socket.emit("error", { code: "RESTART_ERROR", message: err.message });
    }
  });
}