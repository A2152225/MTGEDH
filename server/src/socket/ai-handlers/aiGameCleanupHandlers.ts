/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: cleanupGameAI, checkPendingModals, getPendingBlockerDeclaration.
 *
 * Public entry symbols: cleanupGameAI, checkPendingModals, getPendingBlockerDeclaration.
 */
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { getPendingInteractions } from "../../state/modules/turn.js";
import { debug } from "../../utils/debug.js";
import {
  aiActionsInProgress,
  aiEngine,
  aiPlayers,
  clearScheduledAIActionsForGame,
  getAIActionKey,
} from "./aiScheduler.js";

/**
 * Clean up AI players when game ends
 */
export function cleanupGameAI(gameId: string): void {
  clearScheduledAIActionsForGame(gameId);
  const gameAIs = aiPlayers.get(gameId);
  if (gameAIs) {
    for (const playerId of gameAIs.keys()) {
      aiEngine.unregisterAI(playerId);
      aiActionsInProgress.delete(getAIActionKey(gameId, playerId));
    }
    aiPlayers.delete(gameId);
    debug(1, '[AI] Cleaned up AI players for game:', gameId);
  }
}

/**
 * Check if there are any pending library searches for a game
 */

/**
 * Check if there are any pending modals that should block AI advancement.
 * Returns an object with a boolean flag and optional reason string.
 */
export function checkPendingModals(game: any, gameId: string): { hasPending: boolean; reason?: string } {
  // Check the resolution queue (unified system for all player interactions)
  const queueSummary = ResolutionQueueManager.getPendingSummary(gameId);
  if (queueSummary.hasPending) {
    const pendingTypes = queueSummary.pendingTypes.join(', ');
    return { hasPending: true, reason: `players have pending resolution steps: ${pendingTypes}` };
  }
  
  // Check for pending blocker declarations or other pending interactions
  // This prevents the AI from advancing when humans still need to declare blockers
  const ctx = { state: game.state, bumpSeq: () => {}, gameId } as any;
  const pendingInteractions = getPendingInteractions(ctx);
  if (pendingInteractions.hasPending) {
    const pendingTypes = pendingInteractions.pendingTypes.join(', ');
    return { hasPending: true, reason: `players have pending interactions: ${pendingTypes}` };
  }
  return { hasPending: false };
}

export function getPendingBlockerDeclaration(
  game: any,
  gameId: string,
): { hasPending: boolean; defendingPlayer?: string; defendingPlayerIsAI?: boolean } {
  const ctx = { state: game.state, bumpSeq: () => {}, gameId } as any;
  const pendingInteractions = getPendingInteractions(ctx);
  if (pendingInteractions.pendingTypes.includes('blocker_declaration')) {
    const defendingPlayer = String(pendingInteractions.details?.defendingPlayer || '');
    const players = Array.isArray(game.state?.players) ? game.state.players : [];
    const defendingPlayerEntry = players.find((player: any) => String(player?.id || '') === defendingPlayer);
    return {
      hasPending: true,
      defendingPlayer,
      defendingPlayerIsAI: Boolean(defendingPlayerEntry?.isAI),
    };
  }
  return { hasPending: false };
}
