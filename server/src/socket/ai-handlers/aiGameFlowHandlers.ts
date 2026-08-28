/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: handleAIGameFlow — pregame commander/deck recovery, mulligan
 * handoff, pending-step resolve, and scheduling priority at 0ms after the
 * gameFlow delay.
 *
 * Public entry symbols: handleAIGameFlow.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { appendEvent } from "../../db/index.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import { tryAutoStartGameFromPreGame } from "../pregame-auto-start.js";
import { isGameReplayLocked } from "../../gameRestoreState.js";
import { broadcastGame, ensureGame } from "../util.js";
import { AI_REACTION_DELAY_MS, AI_THINK_TIME_MS } from "./aiConstants.js";
import { commitAIKeepHand } from "./aiKeepHand.js";
import {
  autoSelectAICommander,
  ensureAIPreGameDeckLoaded,
  getAILibraryCards,
} from "./aiPregameHandlers.js";
import { runExclusiveAIAction, scheduleAIGameFlow, scheduleAIPriority } from "./aiScheduler.js";
import { playerCannotReceivePriority } from "../../state/modules/priorityEligibility.js";

/**
 * Handle AI game flow - called when game state changes
 * Ensures AI progresses through pre-game, commander selection, and turn phases
 */
export async function handleAIGameFlow(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<void> {
  const {
    handleAIMulligan,
    handleAIPriority,
    handleAIResolutionStep,
    isAIPlayer,
  } = getAIHandlerDeps();
  return runExclusiveAIAction(io, gameId, playerId, 'gameFlow', async () => {
  if (!isAIPlayer(gameId, playerId)) {
    return;
  }
  
  const game = ensureGame(gameId);
  if (!game || !game.state) {
    return;
  }
  if (isGameReplayLocked(game, gameId)) {
    debug(2, '[AI] handleAIGameFlow skipped during undo/restore replay', { gameId, playerId });
    return;
  }

  const players = game.state.players || [];
  const aiPlayer = players.find((p: any) => p.id === playerId);
  const ctx = (game as any).ctx || game;
  if (playerCannotReceivePriority(aiPlayer, ctx) || (ctx.inactive instanceof Set && ctx.inactive.has(playerId))) {
    if (game.state.priority === playerId) {
      debug(1, '[AI] handleAIGameFlow: eliminated/inactive AI still holds priority; auto-passing:', { gameId, playerId });
      const { executePassPriority } = await import('./aiPriorityPassCombatExecutors.js');
      await executePassPriority(io, gameId, playerId);
    } else {
      debug(1, '[AI] handleAIGameFlow: AI player has left the game, skipping:', { gameId, playerId });
    }
    return;
  }
  
  const phaseStr = String(game.state.phase || '').toUpperCase();
  const stepStr = String((game.state as any).step || '').toUpperCase();
  const commanderInfo = game.state.commandZone?.[playerId];
  const hasCommander = commanderInfo?.commanderIds?.length > 0;
  const zones = game.state.zones?.[playerId];
  const hasHand = (zones?.handCount || 0) > 0 || (zones?.hand?.length || 0) > 0;
  const isAITurn = game.state.turnPlayer === playerId;
  const hasPriority = game.state.priority === playerId;
  
  // Leyline resolution delay - time to allow human players to play/skip Leylines before advancing
  const LEYLINE_RESOLUTION_DELAY_MS = AI_THINK_TIME_MS * 2;
  
  debug(1, '[AI] handleAIGameFlow:', {
    gameId,
    playerId,
    phase: phaseStr,
    step: stepStr,
    hasCommander,
    hasHand,
    handCount: zones?.handCount,
    isAITurn,
    hasPriority,
  });
  
  // Pre-game phase: select commander if not done
  if (phaseStr === '' || phaseStr === 'PRE_GAME') {
    const library = getAILibraryCards(game, playerId);
    if (library.length === 0) {
      debug(1, '[AI] AI has no loaded deck in pre_game, attempting recovery import', {
        gameId,
        playerId,
      });

      const deckRecovered = await ensureAIPreGameDeckLoaded(gameId, playerId);
      if (deckRecovered) {
        broadcastGame(io, game, gameId);
        scheduleAIGameFlow(io, gameId, playerId, AI_THINK_TIME_MS);
      }
      return;
    }

    if (!hasCommander) {
      debug(1, '[AI] AI needs to select commander');
      
      // Small delay to allow deck to be fully set up
      setTimeout(async () => {
        const success = await autoSelectAICommander(io, gameId, playerId);
        if (success) {
          debug(1, '[AI] Commander selection complete, continuing game flow');
          // Re-trigger game flow after commander selection
          scheduleAIGameFlow(io, gameId, playerId, AI_THINK_TIME_MS);
        }
      }, AI_REACTION_DELAY_MS);
      return;
    }
    
    // If we have a commander and hand, auto-keep the hand
    // This is critical to prevent the game from stalling when waiting for AI to keep hand
    if (hasCommander && hasHand) {
      // Check if AI has already kept their hand
      const mulliganState = (game.state as any).mulliganState || {};
      const aiMulliganState = mulliganState[playerId];
      
      if (!aiMulliganState || !aiMulliganState.hasKeptHand) {
        // AI needs to decide whether to keep or mulligan
        debug(1, '[AI] AI evaluating hand for mulligan decision');
        
        const keepHand = await handleAIMulligan(io, gameId, playerId);
        
        if (keepHand) {
          debug(1, '[AI] AI keeping hand');
          await commitAIKeepHand(
            io,
            game,
            gameId,
            playerId,
            aiMulliganState?.mulligansTaken || 0,
            'ai_keep_hand',
          );
          scheduleAIGameFlow(io, gameId, playerId, AI_THINK_TIME_MS);
          return;
        } else {
          // Take a mulligan
          debug(1, '[AI] AI taking mulligan');
          
          const currentMulligans = aiMulliganState?.mulligansTaken || 0;
          const newMulliganCount = currentMulligans + 1;
          
          // Check if player can still mulligan (max 7 mulligans = 0 cards)
          if (newMulliganCount > 7) {
            debugWarn(1, '[AI] AI cannot mulligan further - would have 0 cards');
            await commitAIKeepHand(
              io,
              game,
              gameId,
              playerId,
              currentMulligans,
              'ai_forced_keep',
            );
            scheduleAIGameFlow(io, gameId, playerId, AI_THINK_TIME_MS);
            return;
          }
          
          // Update mulligan count but DON'T set hasKeptHand yet
          (game.state as any).mulliganState = (game.state as any).mulliganState || {};
          (game.state as any).mulliganState[playerId] = {
            hasKeptHand: false,
            mulligansTaken: newMulliganCount,
          };
          
          // Execute the mulligan by moving hand to library, shuffling, and drawing new hand
          // This matches the logic in game-actions.ts socket handler
          try {
            debug(1, `[AI] Executing mulligan #${newMulliganCount} for AI player`);
            
            // Move hand back to library
            if (typeof (game as any).moveHandToLibrary === 'function') {
              (game as any).moveHandToLibrary(playerId);
              debug(1, '[AI] Moved hand to library');
            } else {
              debugWarn(2, '[AI] game.moveHandToLibrary not available');
            }
            
            // Shuffle library
            if (typeof (game as any).shuffleLibrary === 'function') {
              (game as any).shuffleLibrary(playerId);
              debug(1, '[AI] Shuffled library');
            } else {
              debugWarn(2, '[AI] game.shuffleLibrary not available');
            }
            
            // Draw new 7-card hand (London mulligan - put cards back later when keeping)
            if (typeof (game as any).drawCards === 'function') {
              const drawn = (game as any).drawCards(playerId, 7);
              debug(1, '[AI] Drew new 7-card hand, actual drawn:', drawn?.length || 0);
            } else {
              debugWarn(2, '[AI] game.drawCards not available');
            }
            
            // Bump sequence
            if (typeof (game as any).bumpSeq === 'function') {
              (game as any).bumpSeq();
            }
            
            debug(1, '[AI] Mulligan executed successfully');
          } catch (e) {
            debugError(1, '[AI] Error executing mulligan:', e);
          }
          
          // Persist the mulligan event
          try {
            await appendEvent(gameId, (game as any).seq || 0, 'mulligan', {
              playerId,
              mulliganNumber: newMulliganCount,
              isAI: true,
            });
          } catch (e) {
            debugWarn(1, '[AI] Failed to persist mulligan event:', e);
          }
          
          // Broadcast updated state
          broadcastGame(io, game, gameId);
          
          // Re-trigger game flow to evaluate the new hand
          scheduleAIGameFlow(io, gameId, playerId, AI_THINK_TIME_MS);
          return;
        }
      }
      
      // AI has already kept hand — try auto-start once the table is ready
      const waitingForKeep = (players || [])
        .filter((p: any) => p && !p.spectator && !p.isSpectator)
        .filter((p: any) => !(mulliganState?.[p.id]?.hasKeptHand))
        .map((p: any) => p.id);
      if (waitingForKeep.length > 0) {
        debug(1, '[AI] Pregame waiting for keep', { gameId, playerId, waitingForKeep });
      }
      await tryAutoStartGameFromPreGame(io, game, gameId, 'ai_pregame_ready');
    }
    return;
  }
  
  // Active game phases: handle priority if AI has it
  // SPECIAL CASE: During cleanup step, call handleAIPriority even without priority
  // Per MTG Rule 514.1, cleanup step does not grant priority, but the turn player
  // must still perform mandatory actions (discard to hand size, etc.)
  const isCleanupStep = stepStr.toUpperCase() === 'CLEANUP';

  // Resume/reconnect: resolve this AI's pending prompts even when another player has priority.
  // Those steps block global priority passing and are not re-fired as STEP_ADDED after load.
  // Cleanup also needs this: bounce-land return choices can open during cleanup, when
  // priority is withheld (Rule 514.1) and the previous `!isCleanupStep` skip deadlocked.
  if (!hasPriority) {
    try {
      if (ResolutionQueueManager.playerHasPendingSteps(gameId, playerId)) {
        const queue = ResolutionQueueManager.getQueue(gameId);
        const aiStep = queue?.steps?.find((s: any) =>
          s?.playerId === playerId
          && String(s?.status || '').toLowerCase() !== 'completed'
          && String(s?.status || '').toLowerCase() !== 'cancelled'
        );
        if (aiStep) {
          debug(1, '[AI] handleAIGameFlow: resolving pending resolution step without priority:', {
            gameId,
            playerId,
            stepType: aiStep.type,
            stepId: aiStep.id,
          });
          await handleAIResolutionStep(io, gameId, playerId, aiStep);
          scheduleAIGameFlow(io, gameId, playerId, AI_REACTION_DELAY_MS);
          return;
        }
      }
    } catch (err) {
      debugWarn(1, '[AI] handleAIGameFlow: failed pending-step resolve without priority:', err);
    }
  }
  
  if (hasPriority || (isCleanupStep && isAITurn)) {
    // Broadcast/gameFlow already waited AI_REACTION_DELAY_MS. A second delay
    // stacked the UNTAP→UPKEEP handoff outside the 600ms window.
    scheduleAIPriority(io, gameId, playerId, 0);
  }
  });
}

