/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: executePassPriority, executeDeclareAttackers, executeDeclareBlockers.
 *
 * Public entry symbols: executePassPriority, executeDeclareAttackers, executeDeclareBlockers.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { appendEvent } from "../../db/index.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { persistAndResolveTopOfStack, ensureGame, broadcastGame } from "../util.js";
import { runPostResolutionPermanentPromptChecks } from "../game-actions.js";
import { advanceStepPersistingEvent } from "../step-advance.js";
import { executeDeclareAttackers as executeCombatDeclareAttackers } from "../combat.js";
import { AI_REACTION_DELAY_MS } from "./aiConstants.js";
import { scheduleAIPriority } from "./aiScheduler.js";
import { isAIPlayer } from "./aiPlayerRegistry.js";
import { checkPendingModals } from "./aiGameCleanupHandlers.js";

/**
 * Execute pass priority for AI
 */
export async function executePassPriority(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  options?: { allowActiveMainPhaseAutoAdvance?: boolean },
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, '[AI] Passing priority:', { gameId, playerId });
  
  try {
    let resolvedNow = false;
    let advanceStep = false;
    
    // Use game's pass priority method if available
    // Mark as auto-pass so that autoPassLoop runs and checks if other players can also auto-pass
    if (typeof (game as any).passPriority === 'function') {
      const result = (game as any).passPriority(playerId, true, options); // true = isAutoPass
      resolvedNow = result?.resolvedNow ?? false;
      advanceStep = result?.advanceStep ?? false;
    } else {
      // Fallback: advance priority manually
      const state = game.state;
      if (state && Array.isArray(state.players)) {
        const order = state.players.map((p: any) => p.id);
        const idx = order.indexOf(playerId);
        if (idx >= 0) {
          const nextPriority = order[(idx + 1) % order.length];
          (state as any).priority = nextPriority;
        }
      }
    }
    
    // Persist event
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'passPriority', { playerId });
    } catch (e) {
      debugWarn(1, '[AI] Failed to persist passPriority event:', e);
    }
    
    // If all players passed priority in succession, resolve the top of the stack
    if (resolvedNow) {
      debug(1, '[AI] All players passed priority, resolving top of stack');
      if (persistAndResolveTopOfStack(game, gameId, { playerId })) {
        runPostResolutionPermanentPromptChecks(io, game, gameId);
        debug(2, `[AI] Stack resolved for game ${gameId}`);
      }
    }
    
    // If all players passed priority with empty stack, advance to next step
    // BUT: Do NOT advance if there are pending modals (e.g., library searches, color choices, creature type selections, Join Forces)
    // Human players need time to complete their modal interactions
    if (advanceStep) {
      const pendingCheck = checkPendingModals(game, gameId);
      if (pendingCheck.hasPending) {
        debug(1, `[AI] Cannot advance step - ${pendingCheck.reason}`);
      } else {
        debug(1, '[AI] All players passed priority with empty stack, advancing step');
        if (advanceStepPersistingEvent(io, game as any, gameId, { playerId, reason: 'allPlayersPassed' })) {
          debug(2, `[AI] Advanced to next step for game ${gameId}`);

          // Let the normal broadcast-driven AI/auto-pass flow handle any
          // later progression after this step settles.
          delete (game.state as any)._autoPassResult;
        }
      }
    }
    
    // Broadcast updated state
    broadcastGame(io, game, gameId);
    
    // Check if next player is also AI
    const nextPriority = (game.state as any)?.priority;
    if (nextPriority && isAIPlayer(gameId, nextPriority)) {
      // Small delay before AI acts
      scheduleAIPriority(io, gameId, nextPriority, AI_REACTION_DELAY_MS);
    }
    
  } catch (error) {
    debugError(1, '[AI] Error passing priority:', error);
  }
}

/**
 * Execute declare attackers for AI
 */
export async function executeDeclareAttackers(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  attackers: Array<{ creatureId: string; defendingPlayerId: string }>
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, '[AI] Declaring attackers:', { gameId, playerId, attackers });
  
  try {
    if (attackers.length === 0) {
      await executeCombatDeclareAttackers(io, gameId, playerId, []);
      await executePassPriority(io, gameId, playerId);
      return;
    }

    await executeCombatDeclareAttackers(
      io,
      gameId,
      playerId,
      attackers.map((attacker) => ({
        creatureId: attacker.creatureId,
        targetPlayerId: attacker.defendingPlayerId,
      })),
    );
    await executePassPriority(io, gameId, playerId);
    
  } catch (error) {
    debugError(1, '[AI] Error declaring attackers:', error);
    await executePassPriority(io, gameId, playerId);
  }
}

/**
 * Execute declare blockers for AI
 */
export async function executeDeclareBlockers(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  blockers: Array<{ blockerId: string; attackerId: string }>
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, '[AI] Declaring blockers:', { gameId, playerId, blockers });
  
  try {
    const battlefield = game.state?.battlefield || [];
    const state = game.state as any;
    
    // Apply blocker assignments to permanents
    for (const blocker of blockers) {
      const blockerCreature = battlefield.find((perm: any) => perm.id === blocker.blockerId);
      const attackerCreature = battlefield.find((perm: any) => perm.id === blocker.attackerId);
      
      if (blockerCreature && attackerCreature) {
        // Mark the blocker as blocking
        (blockerCreature as any).blocking = (blockerCreature as any).blocking || [];
        (blockerCreature as any).blocking.push(blocker.attackerId);

        // Mark the attacker as being blocked
        (attackerCreature as any).blockedBy = (attackerCreature as any).blockedBy || [];
        (attackerCreature as any).blockedBy.push(blocker.blockerId);
      }
    }
    
    // Mark that blockers have been declared for this player
    // This is CRITICAL to prevent infinite loop in checkPendingInteractions
    state.blockersDeclaredBy = state.blockersDeclaredBy || [];
    if (!state.blockersDeclaredBy.includes(playerId)) {
      state.blockersDeclaredBy.push(playerId);
      debug(1, `[AI] Marked blockers as declared for ${playerId}`);
    }
    
    // Call game method if it exists (for compatibility)
    if (typeof (game as any).declareBlockers === 'function') {
      (game as any).declareBlockers(playerId, blockers);
    }
    
    // Bump sequence number
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    await appendEvent(gameId, (game as any).seq || 0, 'declareBlockers', { playerId, blockers });
    
    // Broadcast the blocker count
    const blockerCount = blockers.length;
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `AI declares ${blockerCount} blocker${blockerCount !== 1 ? "s" : ""}.`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
    
    // After declaring blockers, pass priority to allow responses
    // (cast instants, activate abilities before combat damage)
    // The step will advance when all players pass priority in succession
    await executePassPriority(io, gameId, playerId);
    
  } catch (error) {
    debugError(1, '[AI] Error declaring blockers:', error);
    // Even on error, mark blockers as declared to prevent infinite loop
    const state = game.state as any;
    state.blockersDeclaredBy = state.blockersDeclaredBy || [];
    if (!state.blockersDeclaredBy.includes(playerId)) {
      state.blockersDeclaredBy.push(playerId);
    }
    await executePassPriority(io, gameId, playerId);
  }
}
