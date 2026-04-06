import type { Server, Socket } from "socket.io";
import { games, priorityTimers } from "./socket.js";
import { broadcastGame } from "./util";
import { appendEvent } from "../db";
import { debug, debugWarn, debugError } from "../utils/debug.js";

/**
 * Register disconnect / leave handlers.
 * Robust: tolerates game implementations that do not expose `disconnect`.
 */

function isDeferredLeaveEligible(game: any, playerId: string): boolean {
  try {
    const stateAny = (game?.state || {}) as any;
    const phase = String(stateAny.phase || "").toLowerCase();
    if (!phase || phase === "pre_game" || phase === "pre-game") {
      return false;
    }

    const players = Array.isArray(stateAny.players) ? stateAny.players : [];
    const player = players.find((entry: any) => String(entry?.id || "") === String(playerId));
    if (!player) {
      return false;
    }

    if (player.spectator || player.isSpectator) {
      return false;
    }

    if (player.hasLost || player.eliminated || player.conceded) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function isImmediateConcedeEnabled(game: any): boolean {
  try {
    return Boolean((game?.state as any)?.houseRules?.immediateConcede);
  } catch {
    return false;
  }
}

function markPlayerForDeferredLeave(game: any, playerId: string): { queued: boolean; playerName?: string } {
  try {
    const stateAny = (game?.state || {}) as any;
    const players = Array.isArray(stateAny.players) ? stateAny.players : [];
    const player = players.find((entry: any) => String(entry?.id || "") === String(playerId));
    if (!player) {
      return { queued: false };
    }

    const queuedAt = Date.now();
    player.conceded = true;
    player.concededAt = queuedAt;
    player.departureMode = "leave";
    player.leftGame = true;
    player.leftAt = queuedAt;
    player.connected = false;
    try { delete player.socketId; } catch {}

    if (!stateAny.autoPassForTurn || typeof stateAny.autoPassForTurn !== "object") {
      stateAny.autoPassForTurn = {};
    }
    stateAny.autoPassForTurn[playerId] = true;

    if (stateAny.priorityClaimed instanceof Set) {
      stateAny.priorityClaimed.delete(playerId);
    }

    if (String(stateAny._pauseHumanAutoPassUntilActionFor || "") === String(playerId)) {
      delete stateAny._pauseHumanAutoPassUntilActionFor;
    }

    if (typeof game?.bumpSeq === "function") {
      game.bumpSeq();
    }

    return {
      queued: true,
      playerName: String(player.name || playerId),
    };
  } catch {
    return { queued: false };
  }
}

function emitDeferredLeaveState(io: Server, game: any, gameId: string, playerId: string, playerName: string) {
  try {
    io.to(gameId).emit("playerConceded", {
      gameId,
      playerId,
      playerName,
      message: `${playerName} has left the game. Their permanents will be removed at the start of their next turn.`,
    });
  } catch {}

  try {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${playerName} has left the game. Their permanents will remain until their next turn.`,
      ts: Date.now(),
    });
  } catch {}

  try {
    const statePlayers = Array.isArray(game?.state?.players) ? game.state.players : [];
    const activePlayers = statePlayers.filter(
      (player: any) => !player?.hasLost && !player?.eliminated && !player?.conceded && !player?.isSpectator
    );

    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      const winnerName = String(winner?.name || winner?.id || "Winner");
      io.to(gameId).emit("gameOver", {
        gameId,
        type: "victory",
        winnerId: winner.id,
        winnerName,
        loserId: playerId,
        loserName: playerName,
        message: `${winnerName} wins! All opponents have conceded.`,
      });
      (game.state as any).gameOver = true;
      (game.state as any).winner = winner.id;
    } else if (activePlayers.length === 0) {
      io.to(gameId).emit("gameOver", {
        gameId,
        type: "draw",
        message: "All players have conceded. The game is a draw.",
      });
      (game.state as any).gameOver = true;
    }
  } catch {
    // non-fatal
  }
}

export function registerDisconnectHandlers(io: Server, socket: Socket) {
  // Player manually leaves the game
  socket.on("leaveGame", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') return;

      // Only allow leaving the game the socket is actually joined to.
      if ((socket.data as any)?.gameId && (socket.data as any).gameId !== gameId) {
        socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
        return;
      }

      if (!(socket as any)?.rooms?.has?.(gameId)) {
        socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
        return;
      }

      const game = games.get(gameId);
      const playerId = socket.data?.playerId;
      if (!game || !playerId) return;

      const deferredLeave = !isImmediateConcedeEnabled(game) && isDeferredLeaveEligible(game, playerId);
      let left = false;

      if (deferredLeave) {
        const deferred = markPlayerForDeferredLeave(game, playerId);
        left = deferred.queued;

        try {
          if (typeof (game as any).disconnect === "function") {
            (game as any).disconnect(socket.id);
          }
        } catch (e) {
          debugWarn(1, "leaveGame disconnect cleanup failed:", e);
        }

        if (left) {
          try {
            appendEvent(gameId, (game as any).seq, "leave", {
              playerId,
              deferred: true,
              departureMode: "leave",
              playerName: deferred.playerName,
            });
          } catch {}

          emitDeferredLeaveState(io, game, gameId, playerId, deferred.playerName || String(playerId));
        }
      } else {
        left = typeof (game as any).leave === "function" ? (game as any).leave(playerId) : false;

        if (left) {
          try {
            if (typeof (game as any).applyEvent === "function") {
              (game as any).applyEvent({ type: "leave", playerId });
            }
          } catch {
            // non-fatal
          }
          try {
            appendEvent(gameId, (game as any).seq, "leave", { playerId });
          } catch {}
        }
      }
      try { socket.leave(gameId); } catch {}

      try {
        if ((socket.data as any)?.gameId === gameId) {
          (socket.data as any).gameId = null;
        }
      } catch {}
      try {
        if ((socket.data as any)?.role) {
          delete (socket.data as any).role;
        }
      } catch {}

      if (left) {
        try { broadcastGame(io, game, gameId); } catch (e) { /* non-fatal */ }
      }
    } catch (e) {
      debugWarn(1, "leaveGame handler failed:", e);
    }
  });

  // Handle socket disconnection
  socket.on("disconnect", () => {
    try {
      const gameId = socket.data?.gameId;
      const playerId = socket.data?.playerId;
      if (!gameId || !games.has(gameId)) return;

      const game = games.get(gameId)!;

      // Preferred: call game.disconnect if provided by the game implementation
      if (typeof (game as any).disconnect === "function") {
        try {
          (game as any).disconnect(socket.id);
        } catch (e) {
          debugWarn(1, "game.disconnect threw:", e);
        }
      } else {
        // Fallback: remove participant entries and attempt to mark player as left/disconnected
        try {
          // Remove participant entries that reference this socket id
          if (Array.isArray((game as any).participantsList)) {
            for (let i = (game as any).participantsList.length - 1; i >= 0; i--) {
              if ((game as any).participantsList[i].socketId === socket.id) {
                (game as any).participantsList.splice(i, 1);
              }
            }
          }
        } catch (e) {
          // ignore
        }

        // If playerId present, try to gracefully remove / mark disconnected
        if (playerId) {
          try {
            // If the game exposes leave(playerId), use it
            if (typeof (game as any).leave === "function") {
              const removed = (game as any).leave(playerId);
              // persist leave event and broadcast if the player was removed
              if (removed) {
                try {
                  if (typeof (game as any).applyEvent === "function") (game as any).applyEvent({ type: "leave", playerId });
                } catch {}
                try { appendEvent(gameId, (game as any).seq, "leave", { playerId }); } catch {}
                try { broadcastGame(io, game, gameId); } catch {}
              }
            } else {
              // No leave API: best-effort mark player object as disconnected / remove socketId
              try {
                if (game.state && Array.isArray(game.state.players)) {
                  const pl = game.state.players.find((p: any) => p.id === playerId);
                  if (pl) {
                    // best-effort properties, don't assume schema
                    try { (pl as any).connected = false; } catch {}
                    try { delete (pl as any).socketId; } catch {}
                  }
                }
              } catch {}
            }
          } catch (e) {
            debugWarn(1, "disconnect fallback handling failed:", e);
          }
        }
      }

      // Clear priority timer if the disconnected player had priority
      try {
        if ((game as any).state && (game as any).state.priority === playerId) {
          const timer = priorityTimers.get(gameId);
          if (timer) {
            clearTimeout(timer);
            priorityTimers.delete(gameId);
          }
        }
      } catch (e) {
        // ignore
      }
    } catch (err) {
      debugWarn(1, "disconnect handler unexpected error:", err);
    }
  });
}
