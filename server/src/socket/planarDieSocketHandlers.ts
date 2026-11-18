// server/src/socket/planarDieSocketHandlers.ts
// Origin parent: new module (the generic d-N roll lives in randomness.ts).
// Public entry symbols: registerPlanarDieHandlers, handleRollPlanarDieRequest.
// Socket event `rollPlanarDie` { gameId }: the active player takes the planar die special action
// (CR 901.9). Timing, the generic mana cost and persistence (`planarDieRoll` event) live in
// state/modules/planarDieSpecialAction.ts; this file only validates the seat and reports the result.

import type { Server, Socket } from "socket.io";
import { ensureGame, getPlayerName, broadcastGame } from "./util.js";
import { debugError } from "../utils/debug.js";
import { ResolutionQueueManager } from "../state/resolution/index.js";
import {
  performPlanarDieSpecialAction,
  planarDieRollAnnouncement,
} from "../state/modules/planarDieSpecialAction.js";

function emitRollError(socket: Socket, message: string, code = "PLANAR_DIE_ERROR"): void {
  socket.emit("error", { code, message });
}

export function handleRollPlanarDieRequest(
  io: Server,
  socket: Socket,
  payload?: { gameId?: unknown },
): void {
  const gameId = payload?.gameId;
  try {
    if (!gameId || typeof gameId !== "string") return;
    if (
      ((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) ||
      !(socket as any)?.rooms?.has?.(gameId)
    ) {
      emitRollError(socket, "Not in game.", "NOT_IN_GAME");
      return;
    }

    const game = ensureGame(gameId);
    const playerId = socket.data.playerId as string | undefined;
    if (!game || !playerId) {
      emitRollError(socket, "Game not found or player not identified.");
      return;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === playerId) : undefined;
    const seatIsSpectator = !!(seated && ((seated as any).spectator || (seated as any).isSpectator));
    const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
    if (!seated || seatIsSpectator || socketIsSpectator) {
      emitRollError(socket, "Not authorized.", "NOT_AUTHORIZED");
      return;
    }

    if (ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any).length > 0) {
      emitRollError(socket, "Finish your pending choices before rolling the planar die.");
      return;
    }

    const ctx = { ...game, gameId, state: game.state, io } as any;
    const result = performPlanarDieSpecialAction(ctx, playerId);
    if (!result.ok) {
      emitRollError(socket, result.reason || "Cannot roll the planar die right now.");
      return;
    }

    const playerName = getPlayerName(game, playerId);
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: planarDieRollAnnouncement(playerName, result),
      ts: Date.now(),
    });
    try {
      broadcastGame(io, game as any, gameId);
    } catch {
      /* best-effort */
    }
  } catch (err) {
    debugError(1, `rollPlanarDie error for game ${String(gameId)}:`, err);
    emitRollError(socket, "Failed to roll the planar die.");
  }
}

export function registerPlanarDieHandlers(io: Server, socket: Socket): void {
  socket.on("rollPlanarDie", (payload?: { gameId?: unknown }) => handleRollPlanarDieRequest(io, socket, payload));
}
