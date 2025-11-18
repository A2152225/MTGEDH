import type { Server, Socket } from "socket.io";
import { games, priorityTimers } from "./socket";
import { broadcastGame } from "./util";
import { appendEvent } from "../db";

/**
 * Register disconnect / leave handlers.
 * Robust: tolerates game implementations that do not expose `disconnect`.
 */

export function registerDisconnectHandlers(io: Server, socket: Socket) {
  // Player manually leaves the game
  socket.on("leaveGame", ({ gameId }: { gameId: string }) => {
    try {
      const game = games.get(gameId);
      const playerId = socket.data?.playerId;
      if (!game || !playerId) return;

      const left = typeof (game as any).leave === "function" ? (game as any).leave(playerId) : false;
      try { socket.leave(gameId); } catch {}

      if (left) {
        try {
          if (typeof (game as any).applyEvent === "function") (game as any).applyEvent({ type: "leave", playerId });
          // persist best-effort
          try { appendEvent(gameId, (game as any).seq, "leave", { playerId }); } catch {}
        } catch (e) {
          // non-fatal
        }
        try { broadcastGame(io, game, gameId); } catch (e) { /* non-fatal */ }
      }
    } catch (e) {
      console.warn("leaveGame handler failed:", e);
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
          console.warn("game.disconnect threw:", e);
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
            console.warn("disconnect fallback handling failed:", e);
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
      console.warn("disconnect handler unexpected error:", err);
    }
  });
}