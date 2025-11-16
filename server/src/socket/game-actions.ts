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

      // Lightweight debug logging to help trace why nextTurn requests may be rejected
      try {
        console.info(`[nextTurn] request from player=${playerId} game=${gameId} turnPlayer=${game.state?.turnPlayer} stack=${(game.state?.stack||[]).length} phase=${String(game.state?.phase)}`);
      } catch (e) { /* ignore logging errors */ }

      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      // tightened: only empty/undefined phase qualifies as pregame
      const pregame = phaseStr === "";

      // If turnPlayer is set, only active player may advance.
      if (game.state.turnPlayer) {
        if (game.state.turnPlayer !== playerId) {
          socket.emit("error", { code: "NEXT_TURN", message: "Only the active player can advance the turn." });
          console.info(`[nextTurn] rejected - not active player (player=${playerId} turnPlayer=${game.state.turnPlayer})`);
          return;
        }
      } else {
        // No turnPlayer set (resumed or not-yet-started). Allow advance only during pregame (empty phase).
        if (!pregame) {
          socket.emit("error", { code: "NEXT_TURN", message: "No active player set; cannot advance turn." });
          console.info(`[nextTurn] rejected - no turnPlayer and not pregame (phase=${phaseStr})`);
          return;
        } else {
          console.info(`[nextTurn] no turnPlayer; allowing advance in pregame (player=${playerId} phase=${phaseStr})`);
        }
      }

      if (game.state.stack && game.state.stack.length > 0) {
        socket.emit("error", { code: "NEXT_TURN", message: "Cannot advance turn while the stack is not empty." });
        console.info(`[nextTurn] rejected - stack not empty (len=${game.state.stack.length})`);
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

      // Lightweight debug logging to help trace why nextStep requests may be rejected
      try {
        console.info(`[nextStep] request from player=${playerId} game=${gameId} turnPlayer=${game.state?.turnPlayer} step=${String(game.state?.step)} stack=${(game.state?.stack||[]).length} phase=${String(game.state?.phase)}`);
      } catch (e) { /* ignore logging errors */ }

      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      // tightened: only empty/undefined phase qualifies as pregame
      const pregame = phaseStr === "";

      if (game.state.turnPlayer) {
        if (game.state.turnPlayer !== playerId) {
          socket.emit("error", { code: "NEXT_STEP", message: "Only the active player can advance the step." });
          console.info(`[nextStep] rejected - not active player (player=${playerId} turnPlayer=${game.state.turnPlayer})`);
          return;
        }
      } else {
        // No turnPlayer set; allow step advancement in pregame to enable resumed games to progress
        if (!pregame) {
          socket.emit("error", { code: "NEXT_STEP", message: "No active player set; cannot advance step." });
          console.info(`[nextStep] rejected - no turnPlayer and not pregame (phase=${phaseStr})`);
          return;
        } else {
          console.info(`[nextStep] no turnPlayer; allowing advance in pregame (player=${playerId} phase=${phaseStr})`);
        }
      }

      if (game.state.stack && game.state.stack.length > 0) {
        socket.emit("error", { code: "NEXT_STEP", message: "Cannot advance step while the stack is not empty." });
        console.info(`[nextStep] rejected - stack not empty (len=${game.state.stack.length})`);
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