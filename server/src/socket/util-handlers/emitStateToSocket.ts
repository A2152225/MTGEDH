// server/src/socket/util-handlers/emitStateToSocket.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: emitStateToSocket - normalized state snapshot to one socket.
// Public entry symbols: emitStateToSocket.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import type { Server } from "socket.io";
import type { GameID, PlayerID } from "../../../../shared/src/index.js";
import { games } from "../socket.js";
import { debugWarn } from "../../utils/debug.js";
import { normalizeViewForEmit } from "./gameStateEmitNormalize.js";

/**
 * Emit a full, normalized state snapshot directly to a specific socketId for a given game,
 * using the same normalization semantics as other emitters.
 */
export function emitStateToSocket(
  io: Server,
  gameId: GameID,
  socketId: string,
  playerId?: PlayerID
) {
  try {
    const game = games.get(gameId);
    if (!game) return;

    let rawView: any;
    try {
      if (typeof (game as any).viewFor === "function" && playerId) {
        rawView = (game as any).viewFor(playerId, false);
      } else if (typeof (game as any).viewFor === "function") {
        const statePlayers: any[] = (game as any).state?.players || [];
        const firstId: string | undefined = statePlayers[0]?.id;
        rawView = firstId
          ? (game as any).viewFor(firstId, false)
          : (game as any).state;
      } else {
        rawView = (game as any).state;
      }
    } catch {
      rawView = (game as any).state;
    }

    const view = normalizeViewForEmit(rawView, game);
    try {
      io.to(socketId).emit("state", {
        gameId,
        view,
        seq: (game as any).seq || 0,
      });
    } catch (e) {
      debugWarn(1, 
        "emitStateToSocket: failed to emit state to socket",
        socketId,
        e
      );
    }
  } catch (e) {
    debugWarn(1, "emitStateToSocket: failed to build or emit view", e);
  }
}
