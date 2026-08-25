// server/src/socket/util-handlers/broadcastManaPoolUpdate.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: broadcastManaPoolUpdate - manaPoolUpdate socket emit plus
//   optional full-state broadcast for P/T that depends on the pool.
// Public entry symbols: runBroadcastManaPoolUpdate.
// Parent keeps the public wrapper and supplies ensureGame / broadcastGame
//   (cycle-safe).

import type { Server } from "socket.io";
import type { ManaPool } from "../../../../shared/src/index.js";
import type { InMemoryGame } from "../../state/types.js";
import { debugWarn } from "../../utils/debug.js";
import { getTotalManaInPool } from "./manaRestrictedPoolOperations.js";

export type BroadcastManaPoolUpdateDeps = {
  ensureGame: (gameId: string) => InMemoryGame | undefined;
  broadcastGame: (io: Server, game: InMemoryGame, gameId: string) => void;
};

/**
 * Broadcast mana pool update to all clients
 * Also broadcasts full game state to update any P/T that depends on mana pool (e.g., Omnath)
 */
export function runBroadcastManaPoolUpdate(
  io: Server,
  gameId: string,
  playerId: string,
  manaPool: ManaPool,
  reason: string | undefined,
  game: any,
  deps: BroadcastManaPoolUpdateDeps,
): void {
  const { ensureGame, broadcastGame } = deps;
  try {
    // Loop-shortcut batches suppress mid-batch UI updates; final forceStateReplace carries mana.
    if (game && Number((game.state as any)?._suppressBroadcastCount || 0) > 0) {
      return;
    }
    if (!game) {
      try {
        const live = ensureGame(gameId);
        if (live && Number((live.state as any)?._suppressBroadcastCount || 0) > 0) {
          return;
        }
      } catch {
        // continue
      }
    }

    const totalMana = getTotalManaInPool({ manaPool: { [playerId]: manaPool } }, playerId);
    
    io.to(gameId).emit('manaPoolUpdate', {
      gameId,
      playerId,
      manaPool: {
        white: manaPool.white || 0,
        blue: manaPool.blue || 0,
        black: manaPool.black || 0,
        red: manaPool.red || 0,
        green: manaPool.green || 0,
        colorless: manaPool.colorless || 0,
        restricted: manaPool.restricted,
        doesNotEmpty: manaPool.doesNotEmpty,
        convertsToColorless: manaPool.convertsToColorless,
        noEmptySourceIds: manaPool.noEmptySourceIds,
      },
      totalMana,
      reason,
    });
    
    // Also broadcast full game state to update P/T of creatures that depend on mana pool
    // (e.g., Omnath, Locus of Mana gets +1/+1 for each green mana)
    if (game) {
      broadcastGame(io, game, gameId);
    }
  } catch (err) {
    debugWarn(1, `[util] broadcastManaPoolUpdate failed:`, err);
  }
}
