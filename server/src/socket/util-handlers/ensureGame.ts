// server/src/socket/util-handlers/ensureGame.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: EnsureGameOptions, ensureGame, ensureGameAsync.
// Public entry symbols: EnsureGameOptions, ensureGame, ensureGameAsync.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import { games } from "../socket.js";
import { createGameIfNotExists, getEvents, gameExistsInDb } from "../../db/index.js";
import { createInitialGameState } from "../../state/index.js";
import type { InMemoryGame } from "../../state/types.js";
import { GameManager } from "../../GameManager.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { BOOT_ID } from "../../utils/bootId.js";
import { pruneObsoleteResolutionQueueAfterReplay } from "../../state/resolution/replayCleanup.js";
import { ensureStateZonesForPlayers } from "./playerStateZones.js";

/* ------------------- Core exported utilities (based on original file) ------------------- */

/**
 * Options for ensureGame when creating a new game with creator tracking.
 */
export interface EnsureGameOptions {
  createdBySocketId?: string;
  createdByPlayerId?: string;
}

/**
 * Ensures that the specified game exists in both database and memory, creating it if necessary.
 * Prefer using the centralized GameManager to ensure consistent factory/reset behavior.
 * Falls back to the local create/replay flow if GameManager is not available or fails.
 *
 * Returns an InMemoryGame wrapper with a fully-initialized runtime state.
 */
export function ensureGame(gameId: string, options?: EnsureGameOptions): InMemoryGame | undefined {
  // Defensive validation: reject invalid/falsy gameId early to prevent creating games with no id.
  if (!gameId || typeof gameId !== "string" || gameId.trim() === "") {
    const msg = `ensureGame called with invalid gameId: ${String(gameId)}`;
    debugError(1, "[ensureGame] " + msg, { bootId: BOOT_ID });
    throw new Error(msg);
  }

  // Prefer GameManager to keep a single source of truth for game creation/reset, if it's exposing helper methods.
  try {
    if (GameManager && typeof (GameManager as any).getGame === "function") {
      try {
        const gmGame =
          (GameManager as any).getGame(gameId) ||
          (GameManager as any).ensureGame?.(gameId);
        if (gmGame) {
          try {
            games.set(gameId, gmGame);
          } catch {
            /* best-effort */
          }
          try {
            ensureStateZonesForPlayers(gmGame);
          } catch {
            /* ignore */
          }
          return gmGame as InMemoryGame;
        }
        // GameManager.ensureGame returned undefined - game doesn't exist in DB (was deleted)
        // Don't fall through to local recreation
        return undefined;
      } catch (err) {
        debugWarn(2,
          "ensureGame: GameManager.getGame/ensureGame failed, falling back to local recreation:",
          { bootId: BOOT_ID, gameId },
          err
        );
      }
    }
  } catch (err) {
    debugWarn(2, "ensureGame: GameManager not usable, falling back:", { bootId: BOOT_ID, gameId }, err);
  }

  // Original fallback behavior - but first check if the game exists in the database
  let game = games.get(gameId) as InMemoryGame | undefined;

  if (!game) {
    // IMPORTANT: Check if the game exists in the database before recreating it.
    // This prevents re-creating games that were previously deleted.
    if (!gameExistsInDb(gameId)) {
      debug(1, 
        `[ensureGame] game ${gameId} does not exist in database, not recreating (may have been deleted)`,
        { bootId: BOOT_ID, gameId }
      );
      return undefined;
    }

    game = createInitialGameState(gameId) as InMemoryGame;

    // No need to call createGameIfNotExists since we already verified the game exists in DB
    // The game data is already persisted, we're just restoring the in-memory state

    try {
      const persisted = getEvents(gameId) || [];
      const replayEvents = persisted.map((ev: any) => ({
        type: ev.type,
        ...(ev.payload || {}),
      }));
      if (typeof (game as any).replay === "function") {
        (game as any).replay(replayEvents);
      } else if (typeof (game as any).applyEvent === "function") {
        for (const e of replayEvents) {
          (game as any).applyEvent(e);
        }
      }
    } catch (err) {
      debugWarn(1, 
        "ensureGame: replay persisted events failed, continuing with fresh state:",
        { bootId: BOOT_ID, gameId },
        err
      );
    }

    try {
      ensureStateZonesForPlayers(game);
    } catch {
      /* ignore */
    }

    try {
      pruneObsoleteResolutionQueueAfterReplay(gameId, game.state, (game as any).libraries);
    } catch (err) {
      debugWarn(1, 'ensureGame: prune replayed resolution prompts failed:', { bootId: BOOT_ID, gameId }, err);
    }

    // Re-register AI players after replay (done asynchronously to keep function synchronous)
    if (game.state && Array.isArray(game.state.players)) {
      // Dynamically import AI module to avoid circular dependencies
      import('../ai.js').then((aiModule) => {
        if (aiModule && aiModule.rehydrateAIGameRuntime) {
          const restored = aiModule.rehydrateAIGameRuntime(gameId, { refreshDeckProfiles: true });
          debug(1, '[ensureGame] Rehydrated AI runtime after replay:', {
            bootId: BOOT_ID,
            gameId,
            restoredPlayers: restored,
          });
        }
      }).catch(err => {
        debugWarn(1, '[ensureGame] Error rehydrating AI runtime:', { bootId: BOOT_ID, gameId }, err);
      });
    }

    games.set(gameId, game);
  }

  return game;
}

/**
 * Async variant of {@link ensureGame} that yields during event replay so
 * resume progress can be broadcast to the game browser.
 */
export async function ensureGameAsync(
  gameId: string,
  options?: EnsureGameOptions,
): Promise<InMemoryGame | undefined> {
  if (!gameId || typeof gameId !== "string" || gameId.trim() === "") {
    const msg = `ensureGameAsync called with invalid gameId: ${String(gameId)}`;
    debugError(1, "[ensureGameAsync] " + msg, { bootId: BOOT_ID });
    throw new Error(msg);
  }

  try {
    if (GameManager && typeof (GameManager as any).ensureGameAsync === "function") {
      const gmGame = await (GameManager as any).ensureGameAsync(gameId);
      if (gmGame) {
        try {
          games.set(gameId, gmGame);
        } catch {
          /* best-effort */
        }
        try {
          ensureStateZonesForPlayers(gmGame);
        } catch {
          /* ignore */
        }
        return gmGame as InMemoryGame;
      }
      return undefined;
    }
  } catch (err) {
    debugWarn(2,
      "ensureGameAsync: GameManager.ensureGameAsync failed, falling back to sync ensureGame:",
      { bootId: BOOT_ID, gameId },
      err
    );
  }

  return ensureGame(gameId, options);
}
