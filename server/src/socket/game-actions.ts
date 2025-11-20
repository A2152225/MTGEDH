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

  // Claim turn (pre-game only) - set yourself as active player when pre-game and turnPlayer is unset.
  socket.on("claimMyTurn", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      const pregame = phaseStr === "" || phaseStr === "PRE_GAME" || phaseStr.includes("BEGIN");

      if (!pregame) {
        socket.emit("error", { code: "CLAIM_TURN_NOT_PREGAME", message: "Claiming turn only allowed in pre-game." });
        return;
      }

      if (game.state.turnPlayer) {
        socket.emit("error", { code: "CLAIM_TURN_EXISTS", message: "Active player already set." });
        return;
      }

      // Set as active player
      try {
        game.state.turnPlayer = playerId;
        appendGameEvent(game, gameId, "claimTurn", { by: playerId });
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `Player ${playerId} claimed first turn.`,
          ts: Date.now(),
        });
        broadcastGame(io, game, gameId);
      } catch (e) {
        console.error("claimMyTurn: failed to set turnPlayer", e);
        socket.emit("error", { code: "CLAIM_TURN_FAILED", message: String(e) });
      }
    } catch (err) {
      console.error("claimMyTurn handler failed:", err);
    }
  });

  // Next turn
  socket.on("nextTurn", async ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Lightweight debug logging to help trace why nextTurn requests may be rejected
      try {
        console.info(
          `[nextTurn] request from player=${playerId} game=${gameId} turnPlayer=${game.state?.turnPlayer} stack=${(game.state?.stack || []).length} phase=${String(
            game.state?.phase
          )}`
        );
      } catch (e) {
        /* ignore logging errors */
      }

      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      // permissive: accept empty, PRE_GAME, or any "BEGIN" variant as pregame
      const pregame = phaseStr === "" || phaseStr === "PRE_GAME" || phaseStr.includes("BEGIN");

      // Ensure players list exists
      const playersArr: any[] = (game.state && Array.isArray(game.state.players)) ? game.state.players : [];

      // If turnPlayer is set, only active player may advance.
      if (game.state.turnPlayer) {
        if (game.state.turnPlayer !== playerId) {
          socket.emit("error", { code: "NEXT_TURN", message: "Only the active player can advance the turn." });
          console.info(`[nextTurn] rejected - not active player (player=${playerId} turnPlayer=${game.state.turnPlayer})`);
          return;
        }
      } else {
        // No turnPlayer set (resumed or not-yet-started).
        // If single-player game, auto-assign them as active player.
        if (playersArr.length <= 1) {
          try {
            game.state.turnPlayer = playerId;
            appendGameEvent(game, gameId, "autoAssignTurn", { playerId });
            console.info(`[nextTurn] auto-assigned turnPlayer to single player ${playerId}`);
          } catch (e) {
            console.warn("nextTurn: auto-assign failed", e);
          }
        } else {
          // multi-player: allow advance only during pregame permissive states (claimMyTurn should be used)
          if (!pregame) {
            socket.emit("error", { code: "NEXT_TURN", message: "No active player set; cannot advance turn." });
            console.info(`[nextTurn] rejected - no turnPlayer and not pregame (phase=${phaseStr})`);
            return;
          } else {
            // If pregame and turnPlayer unset but player has claimed (handled by claimMyTurn),
            // we still require turnPlayer to be set to proceed. So reject here and suggest claim.
            if (!game.state.turnPlayer) {
              socket.emit("error", { code: "NEXT_TURN_NO_CLAIM", message: "No active player set. Use 'Claim Turn' to set first player." });
              console.info(`[nextTurn] rejected - no turnPlayer; ask user to claim (player=${playerId})`);
              return;
            }
          }
        }
      }

      if (game.state.stack && game.state.stack.length > 0) {
        socket.emit("error", { code: "NEXT_TURN", message: "Cannot advance turn while the stack is not empty." });
        console.info(`[nextTurn] rejected - stack not empty (len=${game.state.stack.length})`);
        return;
      }

      // Defensive invocation: prefer game.nextTurn(), else fall back to applyEvent if present.
      try {
        if (typeof (game as any).nextTurn === "function") {
          // If nextTurn returns a promise, await it.
          await (game as any).nextTurn();
        } else if (typeof (game as any).applyEvent === "function") {
          console.warn("nextTurn: game.nextTurn missing, falling back to applyEvent");
          (game as any).applyEvent({ type: "nextTurn", playerId });
        } else {
          console.error("nextTurn: no nextTurn or applyEvent on game object");
          socket.emit("error", { code: "NEXT_TURN_IMPL_MISSING", message: "Server cannot advance turn: game implementation missing nextTurn" });
          return;
        }
      } catch (e) {
        console.error("nextTurn: game.nextTurn/applyEvent invocation failed:", e);
        socket.emit("error", { code: "NEXT_TURN_IMPL_ERROR", message: String(e) });
        return;
      }

      try { appendGameEvent(game, gameId, "nextTurn"); } catch (e) { console.warn("appendEvent(nextTurn) failed", e); }

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
      socket.emit("error", { code: "NEXT_TURN_ERROR", message: err?.message ?? String(err) });
    }
  });

  // Next step handler
  socket.on("nextStep", async ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Lightweight debug logging to help trace why nextStep requests may be rejected
      try {
        console.info(
          `[nextStep] request from player=${playerId} game=${gameId} turnPlayer=${game.state?.turnPlayer} step=${String(
            game.state?.step
          )} stack=${(game.state?.stack || []).length} phase=${String(game.state?.phase)}`
        );
      } catch (e) {
        /* ignore logging errors */
      }

      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      // permissive: accept empty, PRE_GAME, or any "BEGIN" variant as pregame
      const pregame = phaseStr === "" || phaseStr === "PRE_GAME" || phaseStr.includes("BEGIN");

      const playersArr: any[] = (game.state && Array.isArray(game.state.players)) ? game.state.players : [];

      if (game.state.turnPlayer) {
        if (game.state.turnPlayer !== playerId) {
          socket.emit("error", { code: "NEXT_STEP", message: "Only the active player can advance the step." });
          console.info(`[nextStep] rejected - not active player (player=${playerId} turnPlayer=${game.state.turnPlayer})`);
          return;
        }
      } else {
        // No turnPlayer set.
        if (playersArr.length <= 1) {
          // Auto-assign single-player as active
          try {
            game.state.turnPlayer = playerId;
            appendGameEvent(game, gameId, "autoAssignTurn", { playerId });
            console.info(`[nextStep] auto-assigned turnPlayer to single player ${playerId}`);
          } catch (e) {
            console.warn("nextStep: auto-assign failed", e);
          }
        } else {
          if (!pregame) {
            socket.emit("error", { code: "NEXT_STEP", message: "No active player set; cannot advance step." });
            console.info(`[nextStep] rejected - no turnPlayer and not pregame (phase=${phaseStr})`);
            return;
          } else {
            // In pregame and multi-player, require claim first.
            if (!game.state.turnPlayer) {
              socket.emit("error", { code: "NEXT_STEP_NO_CLAIM", message: "No active player set. Use 'Claim Turn' to set first player." });
              console.info(`[nextStep] rejected - no turnPlayer; ask user to claim (player=${playerId})`);
              return;
            }
          }
        }
      }

      if (game.state.stack && game.state.stack.length > 0) {
        socket.emit("error", { code: "NEXT_STEP", message: "Cannot advance step while the stack is not empty." });
        console.info(`[nextStep] rejected - stack not empty (len=${game.state.stack.length})`);
        return;
      }

      // Defensive invocation: prefer game.nextStep(), else fall back to applyEvent if present.
      try {
        if (typeof (game as any).nextStep === "function") {
          await (game as any).nextStep();
        } else if (typeof (game as any).applyEvent === "function") {
          console.warn("nextStep: game.nextStep missing, falling back to applyEvent");
          (game as any).applyEvent({ type: "nextStep", playerId });
        } else {
          console.error("nextStep: no nextStep or applyEvent on game object");
          socket.emit("error", { code: "NEXT_STEP_IMPL_MISSING", message: "Server cannot advance step: game implementation missing nextStep" });
          return;
        }
      } catch (e) {
        console.error("nextStep: game.nextStep/applyEvent invocation failed:", e);
        socket.emit("error", { code: "NEXT_STEP_IMPL_ERROR", message: String(e) });
        return;
      }

      try { appendGameEvent(game, gameId, "nextStep"); } catch (e) { console.warn("appendEvent(nextStep) failed", e); }
      broadcastGame(io, game, gameId);
    } catch (err) {
      console.error(`nextStep error for game ${gameId}:`, err);
      socket.emit("error", { code: "NEXT_STEP_ERROR", message: err?.message ?? String(err) });
    }
  });

  // Shuffle player's hand (server-authoritative) — randomize order of cards in hand.
  socket.on("shuffleHand", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      const spectator = socket.data.spectator;
      if (!game || !playerId || spectator) return;

      // Locate player's hand array (support different shapes)
      try {
        game.state = game.state || {};
        game.state.zones = game.state.zones || {};
        const zones = game.state.zones[playerId] || null;
        if (!zones || !Array.isArray(zones.hand)) {
          // Try libraries map shape? If no hand present, nothing to shuffle
          socket.emit("error", { code: "SHUFFLE_HAND_NO_HAND", message: "No hand to shuffle." });
          return;
        }

        // Fisher-Yates shuffle of the hand array
        const arr = zones.hand;
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = arr[i];
          arr[i] = arr[j];
          arr[j] = tmp;
        }
        // Ensure handCount remains accurate
        zones.handCount = Array.isArray(zones.hand) ? zones.hand.length : zones.handCount || 0;

        appendGameEvent(game, gameId, "shuffleHand", { playerId });
        broadcastGame(io, game, gameId);
      } catch (e) {
        console.error("shuffleHand failed:", e);
        socket.emit("error", { code: "SHUFFLE_HAND_ERROR", message: String(e) });
      }
    } catch (err) {
      console.error("shuffleHand handler error:", err);
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
      // Make restarted games start in PRE_GAME to be consistent
      try {
        game.state = game.state || {};
        (game.state as any).phase = "PRE_GAME";
      } catch (e) {
        /* best effort */
      }
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
      // Ensure cleared restart is PRE_GAME as well
      try {
        game.state = game.state || {};
        (game.state as any).phase = "PRE_GAME";
      } catch (e) {
        /* best effort */
      }
      appendEvent(gameId, game.seq, "restart", { preservePlayers: false });
      broadcastGame(io, game, gameId);
    } catch (err) {
      socket.emit("error", { code: "RESTART_ERROR", message: err.message });
    }
  });
}