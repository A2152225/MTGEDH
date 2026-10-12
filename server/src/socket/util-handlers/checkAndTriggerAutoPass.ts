// server/src/socket/util-handlers/checkAndTriggerAutoPass.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: checkAndTriggerAutoPass - human/AI auto-pass scheduling and
//   executeAutoPass nested in the parent function.
// Public entry symbols: runCheckAndTriggerAutoPass.
// Parent keeps the public checkAndTriggerAutoPass wrapper and supplies
//   broadcastGame / appendGameEvent / persistAndResolveTopOfStack (cycle-safe).

import type { Server } from "socket.io";
import type { InMemoryGame } from "../../state/types.js";
import type { PlayerID } from "../../../../shared/src/index.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import {
  contextHasBlockingNonPaymentResolutionSteps,
  contextPendingResolutionSummary,
} from "../../state/resolution/resolutionQueueGameIds.js";
import { isPlayerIdleForAutoPass, canRespond, canAct } from "../../state/modules/can-respond.js";
import { getTopTriggeredAbilityAutoPassReason } from "../trigger-shortcuts.js";
import { appendEvent } from "../../db/index.js";
import { isGameReplayLocked } from "../../gameRestoreState.js";
import { getManaPoolFromState, getTotalManaFromPool } from "../../state/modules/mana-check.js";
import { runPostResolutionPermanentPromptChecks } from "../game-actions.js";
import { tryQueueMoxDiamondBeforeStackResolve } from "../../state/modules/mox-diamond-choice.js";
import { advanceStepPersistingEvent } from "../step-advance.js";
import {
  AUTO_PASS_DELAY_MS,
  pendingHumanAutoPassTimers,
  shouldBypassIdleForNonEmptyStack,
  isLoopStackDrainActive,
  clearScheduledHumanAutoPass,
} from "./autoPassTimerState.js";
import { ts, repairMissingPriorityIfStuck } from "./repairMissingPriorityIfStuck.js";
import { kickIdleAutoPassPendingResolutionSteps } from "./autoPassIdleResolutionKick.js";
import { listAttackersAgainstDefender } from "../combat-handlers/combatMustBeBlockedIfAble.js";
import { reassignPriorityIfHolderCannotReceive } from "../../state/modules/priorityEligibility.js";
import { isDisconnectAutoPassGraceBlocking } from "../disconnectAutoPassGrace.js";
import {
  captureIdenticalTriggerRun,
  continueCapturedIdenticalTriggerRun,
  isIdenticalTriggerBulkActive,
} from "../identicalTriggerBulkResolve.js";

export type CheckAndTriggerAutoPassDeps = {
  broadcastGame: (io: Server, game: InMemoryGame, gameId: string) => void;
  appendGameEvent: (game: InMemoryGame, gameId: string, type: string, payload?: Record<string, any>) => any;
  persistAndResolveTopOfStack: (game: InMemoryGame, gameId: string, payload?: Record<string, unknown>) => boolean;
};

/**
 * Check if the current priority holder should auto-pass and trigger it if needed
 * This ensures human players with auto-pass enabled don't get stuck with priority
 * when they have no legal actions available.
 * 
 * For human players, a small delay is added before auto-passing to give them a chance
 * to evaluate the board state and potentially claim priority if they want to act.
 */
export function runCheckAndTriggerAutoPass(
  io: Server,
  game: InMemoryGame,
  gameId: string,
  deps: CheckAndTriggerAutoPassDeps,
): void {
  const { broadcastGame, appendGameEvent, persistAndResolveTopOfStack } = deps;
  try {
    // A bulk identical-trigger run is passing for everyone; it re-broadcasts (and so
    // re-checks auto-pass) when it ends.
    if (isIdenticalTriggerBulkActive(gameId)) {
      return;
    }
    if (isGameReplayLocked(game, gameId)) {
      return;
    }
    const stateAny = game.state as any;
    const ctx = (game as any).ctx || game;
    if (reassignPriorityIfHolderCannotReceive(ctx)) {
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    }
    const priority = stateAny?.priority;
    const priorityPlayerId = priority ? String(priority) as PlayerID : null;
    const existingHumanAutoPass = pendingHumanAutoPassTimers.get(gameId);
    if (existingHumanAutoPass && existingHumanAutoPass.playerId !== priorityPlayerId) {
      clearScheduledHumanAutoPass(gameId);
    }
    
    // ========================================================================
    // DEBUG: Track auto-pass calls to diagnose skip issues
    // ========================================================================
    const debugCallId = `autopass_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    debug(2, `${ts()} [checkAndTriggerAutoPass] ========== CALLED (ID: ${debugCallId}) ==========`);
    debug(2, `${ts()} [checkAndTriggerAutoPass] Priority: ${priority}, Phase: ${stateAny?.phase}, Step: ${stateAny?.step}`);
    // ========================================================================

    const paymentResumeLock = stateAny?._paymentResumeCastLock;
    const completingCasts = stateAny?._completingSpellCastByPlayer;
    if (
      (paymentResumeLock && typeof paymentResumeLock === 'object' && String(paymentResumeLock.playerId || '').trim())
      || (completingCasts && typeof completingCasts === 'object' && Object.keys(completingCasts).length > 0)
    ) {
      clearScheduledHumanAutoPass(gameId);
      debug(2, `${ts()} [checkAndTriggerAutoPass] Spell cast completion in progress - returning early (ID: ${debugCallId})`);
      return;
    }
    
    if (!priority) {
      clearScheduledHumanAutoPass(gameId);
      const repaired = repairMissingPriorityIfStuck(game, gameId, '[checkAndTriggerAutoPass]', debugCallId);
      if (!repaired) {
        const phase = String(stateAny?.phase || '').toLowerCase();
        const step = String(stateAny?.step || '').toUpperCase();
        const pendingSummary = contextPendingResolutionSummary(game, gameId);

        if (phase === 'pre_game' || phase === 'pre-game') {
          debug(2, `${ts()} [checkAndTriggerAutoPass] In pre_game phase, auto-pass disabled (ID: ${debugCallId})`);
          return;
        }

        if (pendingSummary.hasPending) {
          debug(2, `${ts()} [checkAndTriggerAutoPass] Priority is null due to active resolution (${pendingSummary.pendingCount} pending steps), returning (ID: ${debugCallId})`);
          kickIdleAutoPassPendingResolutionSteps(io, game, gameId);
          return;
        }

        if (['UNTAP', 'CLEANUP'].includes(step)) {
          debug(2, `${ts()} [checkAndTriggerAutoPass] No priority holder (step ${step} doesn't grant priority), returning (ID: ${debugCallId})`);
          return;
        }

        debugError(1, `${ts()} [checkAndTriggerAutoPass] Cannot restore priority - no turn player found!`);
        return;
      }
    }
    
    // IMPORTANT: Do not auto-pass during pre_game phase
    // During pre_game, players are selecting decks, commanders, and making mulligan decisions.
    // Auto-pass should not interfere with these setup steps.
    if (stateAny?.phase === 'pre_game' || stateAny?.phase === 'PRE_GAME') {
      clearScheduledHumanAutoPass(gameId, priorityPlayerId);
      debug(2, `${ts()} [checkAndTriggerAutoPass] In pre_game phase, auto-pass disabled (ID: ${debugCallId})`);
      return;
    }
    
    // Prevent re-entry while auto-passing is in progress
    // This avoids recursive calls that might advance steps incorrectly
    if (!stateAny._autoPassInProgress) {
      stateAny._autoPassInProgress = new Set<string>();
    }
    if (stateAny._autoPassInProgress.has(priority)) {
      debug(2, `[checkAndTriggerAutoPass] Already processing auto-pass for ${priority}, skipping re-entry (ID: ${debugCallId})`);
      return;
    }
    
    // Idle players auto-pass; autoPassForTurn, loop stack-drain (non-empty stack
    // only), and top-stack trigger shortcuts bypass the idle check. With a
    // non-empty stack, enabled auto-pass ("Smart Pass") may also bypass — but
    // only for the player's own top stack object — otherwise floating mana /
    // activatable abilities leave them stuck clicking Pass Priority to resolve
    // their own spells. Opponent spells still require a real canRespond check
    // (e.g. Cyclonic Rift vs Murder).
    const autoPassForTurn = stateAny.autoPassForTurn?.[priority] || false;
    const loopStackDrain = stateAny.loopShortcutStackDrain?.[priority] === true;
    const autoPassEnabled = stateAny.autoPassPlayers instanceof Set
      ? stateAny.autoPassPlayers.has(priority)
      : false;
    const stackLen = Array.isArray(game.state?.stack) ? game.state.stack.length : 0;
    const loopDrainActive = isLoopStackDrainActive(loopStackDrain, stackLen);
    const autoPassEmptyStackOnOpponentsTurn =
      (
        stateAny.autoPassEmptyStackOnOpponentsTurn?.[priority] === true
        || stateAny.autoPassEmptyStackForTurn?.[priority] === true
      )
      && stackLen === 0
      && String(stateAny.turnPlayer || '') !== String(priority);
    let triggerAutoPassReason = (autoPassForTurn || loopDrainActive)
      ? undefined
      : getTopTriggeredAbilityAutoPassReason(game.state, priority);
    const bypassIdleForStack = shouldBypassIdleForNonEmptyStack({
      stackLen,
      autoPassEnabled,
      loopStackDrain,
      autoPassForTurn,
      state: game.state,
      playerId: String(priority),
    });
    const pausedForUndoPlayer = String(stateAny._pauseHumanAutoPassUntilActionFor || '').trim();

    if (pausedForUndoPlayer && pausedForUndoPlayer === String(priority)) {
      clearScheduledHumanAutoPass(gameId, priorityPlayerId);
      debug(2, `${ts()} [checkAndTriggerAutoPass] Auto-pass paused for ${priority} until a manual action is taken (ID: ${debugCallId})`);
      return;
    }

    // Never Smart-Pass / stack-drain while a non-payment resolution prompt is open.
    // Mox Diamond / Neera-style bottom-reveal stay on the stack during their choice;
    // without this guard, bypassIdleForStack re-resolves the spell under the prompt.
    if (contextHasBlockingNonPaymentResolutionSteps(game, gameId)) {
      clearScheduledHumanAutoPass(gameId, priorityPlayerId);
      debug(
        2,
        `${ts()} [checkAndTriggerAutoPass] Blocking auto-pass — pending non-payment resolution step (ID: ${debugCallId})`,
      );
      kickIdleAutoPassPendingResolutionSteps(io, game, gameId);
      return;
    }

    const players = stateAny?.players || [];
    const priorityPlayer = players.find((p: any) => p?.id === priority);
    if (priorityPlayer && priorityPlayer.isAI) {
      clearScheduledHumanAutoPass(gameId, priorityPlayerId);
      debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} is AI, handled separately (ID: ${debugCallId})`);
      return;
    }

    if (!stateAny.priorityClaimed) {
      stateAny.priorityClaimed = new Set<string>();
    }
    if (stateAny.priorityClaimed.has(priority)) {
      clearScheduledHumanAutoPass(gameId, priorityPlayerId);
      debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} claimed priority, returning (ID: ${debugCallId})`);
      return;
    }

    if (priorityPlayerId && isDisconnectAutoPassGraceBlocking(gameId, priorityPlayerId, game)) {
      clearScheduledHumanAutoPass(gameId, priorityPlayerId);
      debug(2, `${ts()} [checkAndTriggerAutoPass] Disconnect grace - not auto-passing for ${priority} (ID: ${debugCallId})`);
      return;
    }
    
    // CRITICAL: Forced pass preferences skip the normal legal-action idle check.
    // Loop drain only skips idle while the stack is non-empty.
    if (!autoPassForTurn && !loopDrainActive && !autoPassEmptyStackOnOpponentsTurn && !triggerAutoPassReason && !bypassIdleForStack) {
      const ctx: any = {
        gameId,
        state: game.state,
        libraries: (game as any).libraries || new Map(),
        life: stateAny.life || {},
        poison: {},
        experience: {},
        commandZone: stateAny.commandZone || {},
        joinedBySocket: new Map(),
        participantsList: [],
        tokenToPlayer: new Map(),
        playerToToken: new Map(),
        grants: new Map(),
        inactive: new Set(),
        spectatorNames: new Map(),
        pendingInitialDraw: new Set(),
        handVisibilityGrants: new Map(),
        rngSeed: null,
        rng: () => 0,
        seq: { value: 0 },
        bumpSeq: () => {},
        passesInRow: { value: 0 },
        landsPlayedThisTurn: stateAny.landsPlayedThisTurn || {},
        maxLandsPerTurn: {},
        additionalDrawsPerTurn: {},
        manaPool: stateAny.manaPool || {},
      };

      let playerIdle = false;
      try {
        playerIdle = isPlayerIdleForAutoPass(ctx, priority);
        debug(2, `${ts()} [checkAndTriggerAutoPass] idle check: ${priority} playerIdle=${playerIdle} (ID: ${debugCallId})`);
      } catch (err) {
        debugWarn(1, `[checkAndTriggerAutoPass] Error checking if player ${priority} is idle (ID: ${debugCallId}):`, err);
        return;
      }

      if (!playerIdle) {
        clearScheduledHumanAutoPass(gameId, priorityPlayerId);
        debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} has available actions - returning early, NO auto-pass (ID: ${debugCallId})`);
        return;
      }

      debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} is idle - proceeding with auto-pass (ID: ${debugCallId})`);
    } else if (bypassIdleForStack) {
      debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} bypassing idle (stackLen=${stackLen}, autoPass=${autoPassEnabled}, loopDrain=${loopStackDrain}, autoPassForTurn=${autoPassForTurn}) (ID: ${debugCallId})`);
    } else if (triggerAutoPassReason) {
      debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} will auto-pass due to top stack trigger shortcut (${triggerAutoPassReason}) (ID: ${debugCallId})`);
    } else if (autoPassEmptyStackOnOpponentsTurn) {
      debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} will auto-pass empty stack on opponent ${stateAny.turnPlayer}'s turn (ID: ${debugCallId})`);
    } else {
      debug(2, `[checkAndTriggerAutoPass] Auto-pass for rest of turn / loop drain is enabled for ${priority} - bypassing canAct check`);
    }
    
    // For human players, add a small delay before auto-passing
    // This gives them a moment to see the board state and potentially claim priority
    // AI players and autoPassForTurn skip this delay for snappier gameplay
    const isHumanPlayer = priorityPlayer && !priorityPlayer.isAI;
    
    const executeAutoPass = () => {
      clearScheduledHumanAutoPass(gameId, priorityPlayerId);
      debug(2, `${ts()} [executeAutoPass] ========== EXECUTING for ${priority} (ID: ${debugCallId}) ==========`);
      debug(2, `${ts()} [executeAutoPass] Phase: ${(game.state as any)?.phase}, Step: ${(game.state as any)?.step}`);
      
      // Re-check conditions after delay (state might have changed)
      const currentState = game.state as any;
      const currentPriority = currentState?.priority;
      
      // Only proceed if priority hasn't changed
      if (currentPriority !== priority) {
        debug(2, `${ts()} [executeAutoPass] Priority changed from ${priority} to ${currentPriority}, aborting (ID: ${debugCallId})`);
        return;
      }

      if (isDisconnectAutoPassGraceBlocking(gameId, String(priority), game)) {
        debug(2, `${ts()} [executeAutoPass] Disconnect grace - aborting auto-pass for ${priority} (ID: ${debugCallId})`);
        return;
      }
      
      // Check if player claimed priority during the delay
      if (currentState.priorityClaimed?.has(priority)) {
        debug(2, `${ts()} [executeAutoPass] ${priority} claimed priority during delay, aborting (ID: ${debugCallId})`);
        return;
      }
      
      // CRITICAL FIX: Re-check if player can act before auto-passing
      // This prevents auto-pass from advancing when a player gains the ability to act
      // (e.g., after step advancement gives them priority in their main phase)
      const currentLoopDrain = currentState.loopShortcutStackDrain?.[priority] === true;
      const currentAutoPassForTurn = currentState.autoPassForTurn?.[priority] || false;
      const currentAutoPassEnabled = currentState.autoPassPlayers instanceof Set
        ? currentState.autoPassPlayers.has(priority)
        : false;
      const currentStackLen = Array.isArray(game.state?.stack) ? game.state.stack.length : 0;
      const currentLoopDrainActive = isLoopStackDrainActive(currentLoopDrain, currentStackLen);
      const currentAutoPassEmptyStackOnOpponentsTurn =
        (
          currentState.autoPassEmptyStackOnOpponentsTurn?.[priority] === true
          || currentState.autoPassEmptyStackForTurn?.[priority] === true
        )
        && currentStackLen === 0
        && String(currentState.turnPlayer || '') !== String(priority);
      const currentBypassIdleForStack = shouldBypassIdleForNonEmptyStack({
        stackLen: currentStackLen,
        autoPassEnabled: currentAutoPassEnabled,
        loopStackDrain: currentLoopDrain,
        autoPassForTurn: currentAutoPassForTurn,
        state: game.state,
        playerId: String(priority),
      });
      triggerAutoPassReason = (currentAutoPassForTurn || currentLoopDrainActive)
        ? undefined
        : getTopTriggeredAbilityAutoPassReason(game.state, priority);
      if (!currentAutoPassForTurn && !currentLoopDrainActive && !currentAutoPassEmptyStackOnOpponentsTurn && !triggerAutoPassReason && !currentBypassIdleForStack) {
        // Recreate context for re-check
        // CRITICAL: Use actual game data (libraries, mana pool) for accurate checks
        const recheckCtx: any = {
          gameId,
          state: game.state,
          // Use actual libraries from game, not an empty map
          libraries: (game as any).libraries || new Map(),
          life: currentState.life || {},
          poison: {},
          experience: {},
          commandZone: currentState.commandZone || {},
          joinedBySocket: new Map(),
          participantsList: [],
          tokenToPlayer: new Map(),
          playerToToken: new Map(),
          grants: new Map(),
          inactive: new Set(),
          spectatorNames: new Map(),
          pendingInitialDraw: new Set(),
          handVisibilityGrants: new Map(),
          rngSeed: null,
          rng: () => 0,
          seq: { value: 0 },
          bumpSeq: () => {},
          passesInRow: { value: 0 },
          landsPlayedThisTurn: currentState.landsPlayedThisTurn || {},
          maxLandsPerTurn: {},
          additionalDrawsPerTurn: {},
          // Use actual mana pool from game state
          manaPool: currentState.manaPool || {},
        };
        
        try {
          const playerStillIdle = isPlayerIdleForAutoPass(recheckCtx, priority);
          debug(2, `${ts()} [executeAutoPass] Re-check: ${priority} playerIdle=${playerStillIdle} (ID: ${debugCallId})`);
          
          if (!playerStillIdle) {
            debug(2, `${ts()} [executeAutoPass] Player ${priority} CAN NOW ACT - canceling auto-pass (ID: ${debugCallId})`);
            return;
          }
        } catch (err) {
          debugWarn(1, `${ts()} [executeAutoPass] Error re-checking if player ${priority} is idle (ID: ${debugCallId}):`, err);
          return;
        }
      } else if (triggerAutoPassReason) {
        debug(2, `${ts()} [executeAutoPass] Re-check confirms top stack trigger shortcut (${triggerAutoPassReason}) for ${priority} (ID: ${debugCallId})`);
      }

      const currentStep = String(currentState?.step || '').toUpperCase();
      const turnPlayer = currentState?.turnPlayer;
      const battlefield = game.state?.battlefield || [];
      const isBeingAttacked = listAttackersAgainstDefender(battlefield, priority).length > 0;
      const hasPotentialBlockers = battlefield.some((perm: any) => {
        if (!perm || perm.controller !== priority) return false;
        if (perm.tapped) return false;
        const typeLine = (perm.card?.type_line || '').toLowerCase();
        return typeLine.includes('creature');
      });
      const isDefendingPlayer = isBeingAttacked && hasPotentialBlockers;
      if ((currentStep === 'DECLARE_BLOCKERS' || currentStep.includes('BLOCKERS')) && isDefendingPlayer) {
        debug(2, `${ts()} [executeAutoPass] Skipping auto-pass for ${priority} during DECLARE_BLOCKERS - player has potential blockers (ID: ${debugCallId})`);
        return;
      }

      if (contextHasBlockingNonPaymentResolutionSteps(game, gameId)) {
        debug(
          2,
          `${ts()} [executeAutoPass] Blocking auto-pass — pending non-payment resolution step (ID: ${debugCallId})`,
        );
        kickIdleAutoPassPendingResolutionSteps(io, game, gameId);
        return;
      }
      
      // Player cannot act - auto-pass their priority
      debug(2, `${ts()} [executeAutoPass] Proceeding with auto-pass for ${priority} (ID: ${debugCallId})`);
      
      // Mark that we're processing auto-pass for this player
      const autoPassState = game.state as any;
      if (!autoPassState._autoPassInProgress) {
        autoPassState._autoPassInProgress = new Set<string>();
      }
      autoPassState._autoPassInProgress.add(priority);
      debug(2, `${ts()} [executeAutoPass] Set _autoPassInProgress flag for ${priority} (ID: ${debugCallId})`);
      
      // Call passPriority with isAutoPass flag
      if (typeof (game as any).passPriority === 'function') {
        try {
          const result = (game as any).passPriority(priority, true); // true = isAutoPass
          debug(2, `${ts()} [executeAutoPass] passPriority result: changed=${result.changed}, advanceStep=${result.advanceStep}, resolvedNow=${result.resolvedNow} (ID: ${debugCallId})`);
          
          if (result.changed) {
            // Priority was passed successfully
            appendGameEvent(game, gameId, "passPriority", { by: priority, auto: true });
            
            // Handle stack resolution or step advancement if needed
            if (result.resolvedNow) {
              debug(2, `[checkAndTriggerAutoPass] Stack resolved after auto-pass for ${priority}`);
              if (contextHasBlockingNonPaymentResolutionSteps(game, gameId)) {
                debug(
                  2,
                  `${ts()} [executeAutoPass] Skipping stack resolve — pending non-payment resolution step (ID: ${debugCallId})`,
                );
              } else {
                const deferredMox = tryQueueMoxDiamondBeforeStackResolve(game);
                const identicalRun = captureIdenticalTriggerRun(game);
                if (!deferredMox && persistAndResolveTopOfStack(game, gameId, { auto: true })) {
                  runPostResolutionPermanentPromptChecks(io, game, gameId);
                  // Runs in yielding chunks; broadcasts once when the run ends.
                  void continueCapturedIdenticalTriggerRun(io, game, gameId, identicalRun, () =>
                    broadcastGame(io, game, gameId),
                  );
                }
              }
            }
            
            if (result.advanceStep) {
              // Re-check: a voluntary action may have queued a resolution prompt between
              // schedule and execute (Equip target selection, etc.).
              if (contextHasBlockingNonPaymentResolutionSteps(game, gameId)) {
                debug(
                  2,
                  `${ts()} [executeAutoPass] Skipping step advance - pending non-payment resolution step (ID: ${debugCallId})`,
                );
              } else {
                debug(2, `${ts()} [executeAutoPass] Advancing step after auto-pass for ${priority} (ID: ${debugCallId})`);
                advanceStepPersistingEvent(io, game as any, gameId, {
                  reason: 'autoPassAdvance',
                  by: priority,
                  auto: true,
                });
              }
            }
            
            // Clear the in-progress flag before broadcasting
            // This allows the next player to be checked
            autoPassState._autoPassInProgress?.delete(priority);
            debug(2, `${ts()} [executeAutoPass] Cleared _autoPassInProgress flag for ${priority} (ID: ${debugCallId})`);
            
            // Broadcast updated state after auto-pass
            // Note: This will recursively call checkAndTriggerAutoPass for the next player
            debug(2, `${ts()} [executeAutoPass] Broadcasting state after auto-pass (ID: ${debugCallId})`);
            broadcastGame(io, game, gameId);
            debug(2, `${ts()} [executeAutoPass] Broadcast complete (ID: ${debugCallId})`);
          } else {
            // Priority pass didn't change state - clear flag
            debug(2, `${ts()} [executeAutoPass] Priority pass didn't change state (ID: ${debugCallId})`);
            autoPassState._autoPassInProgress?.delete(priority);
          }
        } catch (err) {
          debugError(1, `${ts()} [executeAutoPass] Error passing priority for ${priority} (ID: ${debugCallId}):`, err);
          // Clear flag on error
          autoPassState._autoPassInProgress?.delete(priority);
        }
      } else {
        // passPriority function not available - clear flag
        debug(2, `${ts()} [executeAutoPass] passPriority function not available (ID: ${debugCallId})`);
        autoPassState._autoPassInProgress?.delete(priority);
      }
    };
    
    // For human players without forced stack-drain, add a small delay
    // This allows them to evaluate and claim priority if needed
    if (isHumanPlayer && !autoPassForTurn && !loopDrainActive && !autoPassEmptyStackOnOpponentsTurn && !bypassIdleForStack && !triggerAutoPassReason) {
      if (existingHumanAutoPass?.playerId === priorityPlayerId) {
        debug(2, `${ts()} [checkAndTriggerAutoPass] Auto-pass already scheduled for ${priority} (ID: ${debugCallId})`);
        return;
      }

      const floatingMana = getTotalManaFromPool(getManaPoolFromState(game.state as any, priorityPlayerId as PlayerID));
      const autoPassDelayMs = floatingMana > 0 ? 750 : AUTO_PASS_DELAY_MS;
      debug(2, `${ts()} [checkAndTriggerAutoPass] Scheduling auto-pass for ${priority} with ${autoPassDelayMs}ms delay (floatingMana=${floatingMana}) (ID: ${debugCallId})`);
      const timeout = setTimeout(executeAutoPass, autoPassDelayMs);
      pendingHumanAutoPassTimers.set(gameId, {
        playerId: priorityPlayerId as PlayerID,
        timeout,
      });
    } else {
      clearScheduledHumanAutoPass(gameId, priorityPlayerId);
      // AI players or stack-drain / autoPassForTurn: execute immediately
      debug(2, `${ts()} [checkAndTriggerAutoPass] Executing auto-pass for ${priority} IMMEDIATELY (isHuman=${isHumanPlayer}, autoPassForTurn=${autoPassForTurn}, emptyStackOpponentTurn=${autoPassEmptyStackOnOpponentsTurn}, loopDrain=${loopStackDrain}, bypassStack=${bypassIdleForStack}) (ID: ${debugCallId})`);
      executeAutoPass();
    }
  } catch (e) {
    debugError(1, '[util] checkAndTriggerAutoPass error:', { gameId, error: e });
  }
}
