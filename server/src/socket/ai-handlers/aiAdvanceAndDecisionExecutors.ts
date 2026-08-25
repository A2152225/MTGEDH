/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: executeAdvanceStep, executeAIDecision.
 *
 * Public entry symbols: executeAdvanceStep, executeAIDecision.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { AIDecisionType } from "../../../../rules-engine/src/AIEngine.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { ensureGame, broadcastGame } from "../util.js";
import { advanceStepPersistingEvent } from "../step-advance.js";
import { AI_PASSIVE_STEP_DELAY_MS, AI_THINK_TIME_MS } from "./aiConstants.js";
import { scheduleAIPriority } from "./aiScheduler.js";
import { isAIPlayer } from "./aiPlayerRegistry.js";
import { checkPendingModals } from "./aiGameCleanupHandlers.js";
import {
  executeDeclareAttackers,
  executeDeclareBlockers,
  executePassPriority,
} from "./aiPriorityPassCombatExecutors.js";

/**
 * Execute advancing to the next step (AI's turn only)
 */
export async function executeAdvanceStep(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  // CRITICAL: Only the turn player can advance steps (fail fast)
  // Non-turn players should pass priority instead
  const turnPlayer = game.state?.turnPlayer;
  if (playerId !== turnPlayer) {
    debugWarn(1, '[AI] Cannot advance step - not the turn player:', { 
      gameId, 
      playerId, 
      turnPlayer,
      message: 'Only the active player can advance game steps'
    });
    // Non-turn player should pass priority instead
    await executePassPriority(io, gameId, playerId);
    return;
  }
  
  const currentStep = String((game.state as any).step || '');
  const currentPhase = String(game.state.phase || '');
  
  // Check if there are any pending modal interactions before advancing
  const pendingCheck = checkPendingModals(game, gameId);
  if (pendingCheck.hasPending) {
    debug(1, `[AI] Cannot advance step - ${pendingCheck.reason}`);
    return;
  }
  
  debug(1, '[AI] Advancing step:', { gameId, playerId, currentPhase, currentStep });
  
  try {
    // Persist nextStep before applying so turn-step trigger pushes follow it in the log.
    if (!advanceStepPersistingEvent(io, game as any, gameId, { playerId, isAI: true })) {
      debugWarn(2, '[AI] game.nextStep not available');
      return;
    }

    delete (game.state as any)._autoPassResult;
    
    const newStep = String((game.state as any).step || '');
    const newPhase = String(game.state.phase || '');
    
    debug(1, '[AI] Step advanced:', { newPhase, newStep });
    
    // Clear cleanup processing flag when advancing from cleanup step
    // This ensures the flag doesn't persist if we re-enter cleanup later
    if (currentStep.toLowerCase().includes('cleanup') && newStep.toLowerCase() !== currentStep.toLowerCase()) {
      if ((game.state as any)._aiProcessingCleanup) {
        debug(1, '[AI] Clearing cleanup processing flags after advancing from cleanup');
        delete (game.state as any)._aiProcessingCleanup;
      }
    }
    
    // Broadcast
    broadcastGame(io, game, gameId);
    
    // If AI still has priority after advancing AND it's the AI's turn, continue handling
    // CRITICAL: Don't continue if it's CLEANUP step (no priority granted during cleanup per Rule 514.1)
    const newPriority = (game.state as any)?.priority;
    const newTurnPlayer = game.state?.turnPlayer;
    const isStillAITurn = newTurnPlayer === playerId;
    const isCleanupStep = String((game.state as any).step || '').toLowerCase().includes('cleanup');
    
    if (newPriority === playerId && isAIPlayer(gameId, playerId) && isStillAITurn && !isCleanupStep) {
      const normalizedNewStep = newStep.toLowerCase();
      const isPassiveStep = /untap|upkeep|draw/.test(normalizedNewStep);
      scheduleAIPriority(
        io,
        gameId,
        playerId,
        isPassiveStep ? AI_PASSIVE_STEP_DELAY_MS : AI_THINK_TIME_MS,
      );
    }
    
  } catch (error) {
    debugError(1, '[AI] Error advancing step:', error);
  }
}

/**
 * Execute an AI decision
 */
export async function executeAIDecision(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  decision: any
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  switch (decision.type) {
    case AIDecisionType.DECLARE_ATTACKERS:
      if (decision.action?.attackers?.length > 0) {
        await executeDeclareAttackers(io, gameId, playerId, decision.action.attackers);
      } else {
        await executeDeclareAttackers(io, gameId, playerId, []);
      }
      break;
      
    case AIDecisionType.DECLARE_BLOCKERS:
      if (decision.action?.blockers?.length > 0) {
        await executeDeclareBlockers(io, gameId, playerId, decision.action.blockers);
      } else {
        // AI chooses not to block - explicitly declare empty blockers to mark as "declared"
        await executeDeclareBlockers(io, gameId, playerId, []);
      }
      break;
      
    case AIDecisionType.PASS_PRIORITY:
    default:
      await executePassPriority(io, gameId, playerId);
      break;
  }
}
