/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: registerAIPlayer / rehydrate / unregister / isAIPlayer /
 * getAIPlayers and the derived-strategy sync they close over.
 *
 * Public entry symbols: registerAIPlayer, rehydrateAIPlayerRuntime,
 * rehydrateAIGameRuntime, unregisterAIPlayer, clearHumanAutopilotSeat,
 * isAIPlayer, getAIPlayers.
 */
import { inferAIStrategyFromDeckProfile } from "../../../../rules-engine/src/aiEngineDeckSupport.js";
import { AIStrategy, type AIPlayerConfig } from "../../../../rules-engine/src/AIEngine.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { debug } from "../../utils/debug.js";
import { games } from "../socket.js";
import { ensureGame } from "../util.js";
import { ensureAIDeckProfile } from "./aiDeckProfileHandlers.js";
import { getPersistedAIPlayerRuntimeData } from "./aiPlayerRuntimeData.js";
import {
  aiActionsInProgress,
  aiEngine,
  aiPlayers,
  clearScheduledAIAction,
  getAIActionKey,
} from "./aiScheduler.js";

/**
 * Register an AI player for a game
 */
function syncAIPlayerDerivedStrategy(game: any, playerId: PlayerID, strategy: AIStrategy): void {
  const player = (game?.state?.players || []).find((entry: any) => entry?.id === playerId);
  if (!player) return;
  player.isAI = true;
  player.strategy = strategy;
  player.aiStrategy = strategy;
}

export function registerAIPlayer(
  gameId: string,
  playerId: PlayerID,
  name?: string,
  difficulty: number = 0.5,
): AIStrategy {
  const game = ensureGame(gameId);
  const deckProfile = game ? ensureAIDeckProfile(game, playerId) || undefined : undefined;
  const strategy = inferAIStrategyFromDeckProfile(deckProfile ?? null);
  const config: AIPlayerConfig = {
    playerId,
    strategy,
    difficulty,
    thinkTime: 500, // 500ms delay for more natural feel
    deckProfile,
  };
  
  aiEngine.registerAI(config);
  
  // Track in per-game map
  if (!aiPlayers.has(gameId)) {
    aiPlayers.set(gameId, new Map());
  }
  aiPlayers.get(gameId)!.set(playerId, config);
  
  // Add AI player to auto-pass set so they automatically pass when they can't respond
  if (game && game.state) {
    const stateAny = game.state as any;
    if (!stateAny.autoPassPlayers || !(stateAny.autoPassPlayers instanceof Set)) {
      stateAny.autoPassPlayers = new Set();
    }
    stateAny.autoPassPlayers.add(playerId);
    ensureAIDeckProfile(game, playerId);
    syncAIPlayerDerivedStrategy(game, playerId, strategy);
    debug(1, '[AI] Added AI player to auto-pass set:', { gameId, playerId });
  }
  
  debug(1, '[AI] Registered AI player:', {
    gameId,
    playerId,
    name: name || playerId,
    strategy,
    difficulty,
    primaryArchetypes: deckProfile?.primaryArchetypes,
  });
  return strategy;
}


export function rehydrateAIPlayerRuntime(
  gameId: string,
  playerId: PlayerID,
  options?: { refreshDeckProfile?: boolean }
): boolean {
  const runtime = getPersistedAIPlayerRuntimeData(gameId, playerId);
  if (!runtime) {
    return false;
  }

  if (options?.refreshDeckProfile && runtime.game?.state) {
    const stateAny = runtime.game.state as any;
    if (stateAny.aiDeckProfiles && typeof stateAny.aiDeckProfiles === 'object') {
      delete stateAny.aiDeckProfiles[playerId];
    }
  }

  const strategy = registerAIPlayer(
    gameId,
    playerId,
    runtime.name,
    runtime.difficulty,
  );
  debug(1, '[AI] Rehydrated AI runtime from persisted state:', {
    gameId,
    playerId,
    strategy,
    difficulty: runtime.difficulty,
    refreshDeckProfile: options?.refreshDeckProfile === true,
  });
  return true;
}

export function rehydrateAIGameRuntime(
  gameId: string,
  options?: { refreshDeckProfiles?: boolean }
): PlayerID[] {
  const game = ensureGame(gameId);
  const restored: PlayerID[] = [];
  for (const player of game?.state?.players || []) {
    if (!player || (player as any).isAI !== true) continue;
    const ok = rehydrateAIPlayerRuntime(gameId, player.id as PlayerID, {
      refreshDeckProfile: options?.refreshDeckProfiles === true,
    });
    if (ok) {
      restored.push(player.id as PlayerID);
    }
  }
  return restored;
}

/**
 * Drop the live seat flags that make a human autopilot seat look like an AI.
 * `isAI` is what `checkAndTriggerAI` and runtime rehydrate read; clearing only
 * `aiControlled` left the seat in the AI loop after the toggle was turned off.
 */
export function clearHumanAutopilotSeat(player: any): void {
  if (!player) return;
  player.isAI = false;
  player.aiControlled = false;
  delete player.ai;
  delete player.aiStrategy;
  delete player.strategy;
  delete player.aiDifficulty;
}

/**
 * Unregister an AI player
 */
export function unregisterAIPlayer(gameId: string, playerId: PlayerID): void {
  aiEngine.unregisterAI(playerId);
  clearScheduledAIAction(gameId, playerId);
  aiActionsInProgress.delete(getAIActionKey(gameId, playerId));
  
  const gameAIs = aiPlayers.get(gameId);
  if (gameAIs) {
    gameAIs.delete(playerId);
    if (gameAIs.size === 0) {
      aiPlayers.delete(gameId);
    }
  }
  
  // Remove AI player from auto-pass set
  const game = ensureGame(gameId);
  if (game && game.state) {
    const stateAny = game.state as any;
    if (stateAny.autoPassPlayers && stateAny.autoPassPlayers instanceof Set) {
      stateAny.autoPassPlayers.delete(playerId);
      debug(1, '[AI] Removed AI player from auto-pass set:', { gameId, playerId });
    }
  }
  
  debug(1, '[AI] Unregistered AI player:', { gameId, playerId });
}

/**
 * Check if a player is AI-controlled
 */
export function isAIPlayer(gameId: string, playerId: PlayerID): boolean {
  const livePlayers = ((games.get(gameId as any)?.state as any)?.players || []) as any[];
  const live = livePlayers.find((entry) => entry?.id === playerId);
  // Explicit off (human autopilot released). Do not let a stale registry entry
  // or rehydrate turn the seat back on. Read the live map only — ensureGame
  // would create or replay a game as a side effect of this predicate.
  if (live && live.isAI === false) return false;

  const registered = aiPlayers.get(gameId)?.has(playerId) ?? false;
  if (registered) return true;

  return rehydrateAIPlayerRuntime(gameId, playerId, { refreshDeckProfile: true });
}

/**
 * Get all AI players for a game
 */
export function getAIPlayers(gameId: string): PlayerID[] {
  const gameAIs = aiPlayers.get(gameId);
  return gameAIs ? Array.from(gameAIs.keys()) : [];
}
