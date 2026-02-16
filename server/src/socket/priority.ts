import type { Server, Socket } from "socket.io";
import { ensureGame, clearPriorityTimer, schedulePriorityTimeout } from "./util";

export function registerPriorityHandlers(io: Server, socket: Socket) {
  function ensureInRoomAndSeated(gameId: string) {
    if (!gameId || typeof gameId !== 'string') return null;

    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return null;
    }

    const pid = socket.data.playerId as string | undefined;
    if (!pid) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return null;
    }

    if ((socket.data as any)?.spectator || (socket.data as any)?.isSpectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return null;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit?.('error', { code: 'GAME_NOT_FOUND', message: 'Game not found.' });
      return null;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
    const seatIsSpectator = !!(seated && ((seated as any).spectator || (seated as any).isSpectator));
    if (!seated || seatIsSpectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return null;
    }

    return { game, pid };
  }

  socket.on("clearPriorityTimer", (payload?: { gameId?: string }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') return;
      const ctx = ensureInRoomAndSeated(gameId);
      if (!ctx) return;

      clearPriorityTimer(gameId);
      socket.emit("priorityTimerCleared", { gameId });
    } catch {
      socket.emit("priorityTimerError", { gameId, message: "Failed to clear priority timer." });
    }
  });

  socket.on("schedulePriorityTimeout", (payload?: { gameId?: string }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') return;
      const ctx = ensureInRoomAndSeated(gameId);
      if (!ctx) return;
      const game = ctx.game;
      schedulePriorityTimeout(io, game, gameId);
      socket.emit("priorityTimerScheduled", { gameId });
    } catch (err) {
      socket.emit("error", { code: "SCHEDULE_PRIORITY_ERROR", message: err.message });
    }
  });
}