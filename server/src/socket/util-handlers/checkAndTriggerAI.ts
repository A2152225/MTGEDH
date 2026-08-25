// server/src/socket/util-handlers/checkAndTriggerAI.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: AI_REACTION_DELAY_MS, checkAndEmitKynaiosChoicePrompts,
//   checkAndEmitPlayerElimination, checkAndTriggerAI.
// Public entry symbols: checkAndTriggerAI, checkAndEmitKynaiosChoicePrompts,
//   checkAndEmitPlayerElimination.
// checkAndTriggerAI is re-exported from util.ts.

import type { Server } from "socket.io";
import type { InMemoryGame } from "../../state/types.js";
import {
  formatGameOverDrawMessage,
  formatGameOverVictoryMessage,
  formatPlayerEliminatedMessage,
} from "../../../../shared/src/gameLogFormat.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { ts } from "./repairMissingPriorityIfStuck.js";

/** AI reaction delay - matches timing in ai.ts */
const AI_REACTION_DELAY_MS = 300;

/**
 * DEPRECATED: Legacy Kynaios choice prompt checker
 * 
 * Kynaios and Tiro choices are now handled by the Resolution Queue system.
 * This function only cleans up any legacy pendingKynaiosChoice state if found.
 */
export function checkAndEmitKynaiosChoicePrompts(io: Server, game: InMemoryGame, gameId: string): void {
  try {
    const gameState = (game as any).state;
    if (!gameState) return;
    
    const pendingKynaiosChoice = gameState.pendingKynaiosChoice;
    if (!pendingKynaiosChoice || Object.keys(pendingKynaiosChoice).length === 0) return;
    
    // Legacy state found - clean it up as this should not be used anymore
    debugWarn(1, `[util] DEPRECATED: Found legacy pendingKynaiosChoice state. This should use Resolution Queue. Cleaning up.`);
    delete gameState.pendingKynaiosChoice;
    delete gameState._kynaiosChoicePromptedPlayers;
    
  } catch (e) {
    debugWarn(1, '[util] checkAndEmitKynaiosChoicePrompts error:', e);
  }
}

/**
 * Check if any player needs to order multiple simultaneous triggers
 * and emit the appropriate prompts
 */
/**
 * Legacy proliferate prompt function removed
 * Proliferate is now handled through processPendingProliferate() in resolution queue
 */

/**
 * Check for newly eliminated players and emit appropriate notifications
 * This handles commander damage wins, life loss, poison counters, etc.
 */
export function checkAndEmitPlayerElimination(io: Server, game: InMemoryGame, gameId: string): void {
  try {
    const gameState = (game as any).state;
    if (!gameState) return;
    
    const players = gameState.players || [];
    
    // Track if we've already notified about this player
    // Store this on the game state to avoid duplicate notifications
    if (!(gameState as any).eliminationNotifications) {
      (gameState as any).eliminationNotifications = new Set<string>();
    }
    const notifiedPlayers = (gameState as any).eliminationNotifications;
    
    // Check each player for elimination
    for (const player of players) {
      if (!player || !player.id) continue;
      
      // Skip if we've already notified about this player
      if (notifiedPlayers.has(player.id)) continue;
      
      // Check if player has been marked as eliminated
      if (player.hasLost || player.eliminated) {
        const playerName = player.name || player.id;
        const reason = player.lossReason || "Unknown reason";
        
        // Mark as notified to avoid duplicate emissions
        notifiedPlayers.add(player.id);
        
        // Emit player elimination event
        io.to(gameId).emit("playerEliminated", {
          gameId,
          playerId: player.id,
          playerName,
          reason,
        });

        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          gameId,
          from: 'system',
          message: formatPlayerEliminatedMessage(playerName, reason),
          ts: Date.now(),
        });
        
        debug(1, `[checkAndEmitPlayerElimination] Player ${playerName} eliminated: ${reason}`);
        
        // Check if game is over (only 1 or 0 active players remaining)
        const activePlayers = players.filter(
          (p: any) =>
            p &&
            p.id &&
            !p.hasLost &&
            !p.eliminated &&
            !p.conceded &&
            !(p.spectator || p.isSpectator)
        );
        
        if (activePlayers.length === 1) {
          // One player left - they win!
          const winner = activePlayers[0];
          const winnerName = winner.name || winner.id;
          
          io.to(gameId).emit("gameOver", {
            gameId,
            type: 'victory',
            winnerId: winner.id,
            winnerName,
            loserId: player.id,
            loserName: playerName,
            message: `${winnerName} Wins!`,
          });

          io.to(gameId).emit('chat', {
            id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            gameId,
            from: 'system',
            message: formatGameOverVictoryMessage(winnerName),
            ts: Date.now(),
          });
          
          // Mark game as over
          gameState.gameOver = true;
          gameState.winner = winner.id;
          
          debug(1, `[checkAndEmitPlayerElimination] Game over! ${winnerName} wins.`);
        } else if (activePlayers.length === 0) {
          // No players left - draw
          io.to(gameId).emit("gameOver", {
            gameId,
            type: 'draw',
            message: "Draw!",
          });

          io.to(gameId).emit('chat', {
            id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            gameId,
            from: 'system',
            message: formatGameOverDrawMessage(),
            ts: Date.now(),
          });
          
          gameState.gameOver = true;
          
          debug(1, `[checkAndEmitPlayerElimination] Game over! Draw.`);
        }
      }
    }
  } catch (err) {
    debugWarn(1, `[checkAndEmitPlayerElimination] Error:`, err);
  }
}

/**
 * Check if the current priority holder is an AI and trigger their turn.
 * Also kicks AI players who have pending resolution prompts after reconnect/replay
 * (those prompts are not re-emitted as STEP_ADDED, so the normal AI handler never runs).
 *
 * Called after broadcasting and after join/resume state sync.
 */
export function checkAndTriggerAI(io: Server, game: InMemoryGame, gameId: string): void {
  try {
    const stateAny = game.state as any;
    // Live IR soaks drive choices themselves; AI auto-play races the driver.
    if (stateAny?.oracleIrLiveSoak === true) return;
    const paymentResumeLock = stateAny?._paymentResumeCastLock;
    const completingCasts = stateAny?._completingSpellCastByPlayer;
    if (
      (paymentResumeLock && typeof paymentResumeLock === 'object' && String(paymentResumeLock.playerId || '').trim())
      || (completingCasts && typeof completingCasts === 'object' && Object.keys(completingCasts).length > 0)
    ) {
      return;
    }

    const priority = stateAny?.priority;
    const players = stateAny?.players || [];

    // Resume/reconnect: AI-owned resolution prompts must be kicked explicitly.
    try {
      const queue = ResolutionQueueManager.getQueue(gameId);
      const pendingAiPlayerIds = new Set<string>();
      for (const step of queue?.steps || []) {
        if (!step || String(step.status || '').toLowerCase() === 'completed' || String(step.status || '').toLowerCase() === 'cancelled') {
          continue;
        }
        const stepPlayerId = String(step.playerId || '').trim();
        if (!stepPlayerId) continue;
        const owner = players.find((p: any) => p?.id === stepPlayerId);
        if (owner?.isAI === true) {
          pendingAiPlayerIds.add(stepPlayerId);
        }
      }
      for (const aiPlayerId of pendingAiPlayerIds) {
        void import('../ai.js').then((aiModule) => {
          if (typeof aiModule.scheduleAIGameFlow === 'function') {
            aiModule.scheduleAIGameFlow(io, gameId, aiPlayerId, AI_REACTION_DELAY_MS);
          } else if (typeof aiModule.scheduleAIPriority === 'function') {
            aiModule.scheduleAIPriority(io, gameId, aiPlayerId, AI_REACTION_DELAY_MS);
          }
        }).catch((e) => {
          debugError(1, '[util] Failed to trigger AI for pending resolution step:', { gameId, playerId: aiPlayerId, error: e });
        });
      }
    } catch (e) {
      debugWarn(2, '[util] checkAndTriggerAI pending-resolution scan failed:', e);
    }
    
    // Special case: Kynaios and Tiro style choices
    // These can affect any player (not just the one with priority)
    // Check if any AI player needs to make a Kynaios choice
    const pendingKynaiosChoice = (game.state as any).pendingKynaiosChoice;
    if (pendingKynaiosChoice) {
      for (const [controllerId, choiceData] of Object.entries(pendingKynaiosChoice)) {
        const choice = choiceData as any;
        if (!choice.active) continue;
        
        const playersWhoMayPlayLand = choice.playersWhoMayPlayLand || [];
        const playersWhoPlayedLand = choice.playersWhoPlayedLand || [];
        const playersWhoDeclined = choice.playersWhoDeclined || [];
        
        // Find AI players who need to make a choice
        for (const playerId of playersWhoMayPlayLand) {
          if (playersWhoPlayedLand.includes(playerId) || playersWhoDeclined.includes(playerId)) {
            continue; // Already made choice
          }
          
          const playerObj = players.find((p: any) => p?.id === playerId);
          if (playerObj && playerObj.isAI) {
            // Trigger AI to handle Kynaios choice
            void import('../ai.js').then((aiModule) => {
              if (typeof aiModule.scheduleAIGameFlow === 'function') {
                aiModule.scheduleAIGameFlow(io, gameId, playerId, AI_REACTION_DELAY_MS);
              } else if (typeof aiModule.handleAIGameFlow === 'function') {
                void aiModule.handleAIGameFlow(io, gameId, playerId).catch((e: any) => {
                  debugError(1, '[util] Failed to trigger AI handler for Kynaios choice:', { gameId, playerId, error: e });
                });
              }
            }).catch((e) => {
              debugError(1, '[util] Failed to trigger AI handler for Kynaios choice:', { gameId, playerId, error: e });
            });
            return; // Exit - handle one AI at a time
          }
        }
      }
    }
    
    if (!priority) return;
    
    // Check if the current priority holder is an AI player
    const priorityPlayer = players.find((p: any) => p?.id === priority);
    
    if (priorityPlayer && priorityPlayer.isAI) {
      // Pre-game still needs commander/mulligan via gameFlow. In-game broadcasts
      // must schedule priority directly — stacking gameFlow + another reaction
      // delay leaves UNTAP/UPKEEP handoffs outside the 600ms test window.
      const phase = String(stateAny?.phase || '').toLowerCase();
      const isPreGame = phase === 'pre_game' || phase === 'pre-game' || phase === '';
      // Dynamically import AI handler to avoid circular deps
      void import('../ai.js').then((aiModule) => {
        if (isPreGame && typeof aiModule.scheduleAIGameFlow === 'function') {
          aiModule.scheduleAIGameFlow(io, gameId, priority, AI_REACTION_DELAY_MS);
        } else if (typeof aiModule.scheduleAIPriority === 'function') {
          aiModule.scheduleAIPriority(io, gameId, priority, AI_REACTION_DELAY_MS);
        } else if (isPreGame && typeof aiModule.handleAIGameFlow === 'function') {
          void aiModule.handleAIGameFlow(io, gameId, priority).catch((e: any) => {
            debugError(1, '[util] Failed to trigger AI handler:', { gameId, playerId: priority, error: e });
          });
        } else if (typeof aiModule.handleAIPriority === 'function') {
          void aiModule.handleAIPriority(io, gameId, priority).catch((e: any) => {
            debugError(1, '[util] Failed to trigger AI handler:', { gameId, playerId: priority, error: e });
          });
        }
      }).catch((e) => {
        debugError(1, '[util] Failed to trigger AI handler:', { gameId, playerId: priority, error: e });
      });
    }
  } catch (e) {
    debugError(1, '[util] checkAndTriggerAI error:', { gameId, error: e });
  }
}
