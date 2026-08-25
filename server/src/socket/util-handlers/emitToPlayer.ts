// server/src/socket/util-handlers/emitToPlayer.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: emitToPlayer - emit an event to a player's connected sockets.
// Public entry symbols: emitToPlayer.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import type { Server } from "socket.io";
import { debugWarn } from "../../utils/debug.js";

/**
 * Emit an event to a specific player's connected sockets.
 * Iterates through all connected sockets and emits to those with matching playerId.
 */
export function emitToPlayer(
  io: Server,
  playerId: string,
  event: string,
  payload: unknown
): void {
  try {
    for (const socket of io.sockets.sockets.values()) {
      try {
        if (
          (socket.data as any)?.playerId === playerId &&
          !(socket.data as any)?.spectator &&
          !(socket.data as any)?.isSpectator
        ) {
          socket.emit(event, payload);
        }
      } catch {
        // ignore per-socket errors
      }
    }
  } catch (err) {
    debugWarn(1, `[util] emitToPlayer failed for ${event}:`, err);
  }
}
