// server/src/socket/util-handlers/priorityTimeoutAutoPass.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: clearPriorityTimer, schedulePriorityTimeout, doAutoPass.
// Public entry symbols: clearPriorityTimer, runSchedulePriorityTimeout,
//   runDoAutoPass.
// Parent keeps schedulePriorityTimeout wrapping runSchedulePriorityTimeout
//   with broadcastGame / appendGameEvent / persistAndResolveTopOfStack /
//   suppressAutomationOnNextBroadcast (cycle-safe).

import type { Server } from "socket.io";
import type { InMemoryGame } from "../../state/types.js";
import { games, priorityTimers, PRIORITY_TIMEOUT_MS } from "../socket.js";
import { canRespond, canAct } from "../../state/modules/can-respond.js";
import { tryQueueMoxDiamondBeforeStackResolve } from "../../state/modules/mox-diamond-choice.js";
import { runPostResolutionPermanentPromptChecks } from "../game-actions.js";
import { getTopTriggeredAbilityAutoPassReason } from "../trigger-shortcuts.js";
import { advanceStepPersistingEvent } from "../step-advance.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { BOOT_ID } from "../../utils/bootId.js";
import { shouldBypassIdleForNonEmptyStack } from "./autoPassTimerState.js";
import { isDisconnectAutoPassGraceBlocking } from "../disconnectAutoPassGrace.js";
import { ts } from "./repairMissingPriorityIfStuck.js";
import { listAttackersAgainstDefender } from "../combat-handlers/combatMustBeBlockedIfAble.js";

export type PriorityTimeoutAutoPassDeps = {
  broadcastGame: (io: Server, game: InMemoryGame, gameId: string) => void;
  appendGameEvent: (game: InMemoryGame, gameId: string, type: string, payload?: Record<string, any>) => any;
  persistAndResolveTopOfStack: (game: InMemoryGame, gameId: string, payload?: Record<string, unknown>) => boolean;
  suppressAutomationOnNextBroadcast: (game: InMemoryGame, delayMs?: number) => void;
};

/**
 * Clears the priority timer for a given Game ID.
 */
export function clearPriorityTimer(gameId: string) {
  const existingTimeout = priorityTimers.get(gameId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    priorityTimers.delete(gameId);
  }
}

/**
 * Schedules a priority pass timeout, automatically passing after the configured delay.
 * If the game has only one active player and a non-empty stack, passes immediately.
 * If priority is null (no player has priority), auto-advance to next step.
 */
export function runSchedulePriorityTimeout(
  io: Server,
  game: InMemoryGame,
  gameId: string,
  deps: PriorityTimeoutAutoPassDeps,
) {
  const { broadcastGame, appendGameEvent, persistAndResolveTopOfStack, suppressAutomationOnNextBroadcast } = deps;
  clearPriorityTimer(gameId);

  try {
    if (!game.state || !game.state.active) return;
    
    // IMPORTANT: Do not auto-advance during pre_game phase
    // During pre_game, players are selecting decks, commanders, and making mulligan decisions.
    const currentPhase = String((game.state as any)?.phase || '').toLowerCase();
    if (currentPhase === 'pre_game') {
      debug(2, `[schedulePriorityTimeout] In pre_game phase, not scheduling timeout for game ${gameId}`, { bootId: BOOT_ID, gameId });
      return;
    }
    
    // If priority is null (no player has priority), auto-advance to next step.
    // This is intended for steps like UNTAP/CLEANUP where we normally don't grant priority.
    // IMPORTANT: Never auto-advance while the stack is non-empty.
    // Otherwise we can skip stack resolution and end up in a later step/turn with spells still on the stack.
    if (!game.state.priority) {
      const stackLen = Array.isArray((game.state as any).stack) ? ((game.state as any).stack as any[]).length : 0;

      if (stackLen > 0) {
        debugWarn(1, `[schedulePriorityTimeout] Priority is null but stack is non-empty (len=${stackLen}); not auto-advancing for game ${gameId}`,
          { bootId: BOOT_ID, gameId, stackLen }
        );
        // Best-effort recovery: ensure some player has priority so the stack can be resolved.
        try {
          if (typeof (game as any).passPriority === 'function') {
            // passPriority with no args will assign priority to the first active player.
            (game as any).passPriority();
          } else if ((game.state as any).turnPlayer) {
            (game.state as any).priority = (game.state as any).turnPlayer;
          }
        } catch {
          // ignore
        }
        try {
          broadcastGame(io, game, gameId);
        } catch {
          // ignore
        }
        return;
      }

      debug(2, `[schedulePriorityTimeout] Priority is null, auto-advancing step for game ${gameId}`, { bootId: BOOT_ID, gameId });
      // Schedule immediate step advancement
      priorityTimers.set(
        gameId,
        setTimeout(() => {
          // Auto-advance to next step
          if (advanceStepPersistingEvent(io, game as any, gameId, { reason: 'noPriority' })) {
            suppressAutomationOnNextBroadcast(game);
            broadcastGame(io, game, gameId);
            debug(2, `[schedulePriorityTimeout] Auto-advanced step (no priority) for game ${gameId}`,
              { bootId: BOOT_ID, gameId }
            );
          }
        }, 0)
      );
      return;
    }
  } catch {
    return;
  }

  const activePlayers = (game.state.players || []).filter(
    (p: any) => !p.inactive
  );
  if (
    activePlayers.length === 1 &&
    Array.isArray(game.state.stack) &&
    game.state.stack.length > 0
  ) {
    priorityTimers.set(
      gameId,
      setTimeout(() => {
        doAutoPass(io, game, gameId, "auto-pass (single player)", deps);
      }, 0)
    );
    return;
  }

  const startSeq = (game as any).seq;
  const timeout = setTimeout(() => {
    priorityTimers.delete(gameId);
    const updatedGame = games.get(gameId);
    if (!updatedGame || (updatedGame as any).seq !== startSeq) return;
    doAutoPass(io, updatedGame, gameId, "auto-pass (timeout)", deps);
  }, PRIORITY_TIMEOUT_MS);

  priorityTimers.set(gameId, timeout);
}

/**
 * Automatically passes the priority during a timeout.
 * For AI players: Always auto-pass.
 * For human players: Only auto-pass if they have no valid responses available.
 */
function doAutoPass(
  io: Server,
  game: InMemoryGame,
  gameId: string,
  reason: string,
  deps: PriorityTimeoutAutoPassDeps,
) {
  const { broadcastGame, appendGameEvent, persistAndResolveTopOfStack } = deps;
  try {
    const playerId = game.state.priority;
    if (!playerId) return;
    const triggerAutoPassReason = getTopTriggeredAbilityAutoPassReason(game.state, playerId);
    
    // Check if priority player exists
    const players = (game.state as any)?.players || [];
    const priorityPlayer = players.find((p: any) => p?.id === playerId);
    
    if (!priorityPlayer) {
      debugWarn(2, `[doAutoPass] Priority player ${playerId} not found in game ${gameId}`);
      return;
    }

    if (!priorityPlayer.isAI && isDisconnectAutoPassGraceBlocking(gameId, String(playerId), game)) {
      debug(2, `[doAutoPass] Skipping auto-pass for ${playerId} - disconnect reconnect grace`);
      return;
    }
    
    // Get turn player and current step for checks below
    const turnPlayer = game.state.turnPlayer;
    const currentStep = (game.state.step || '').toString().toUpperCase();
    
    // In multiplayer, defending player is anyone being attacked, not just "not the turn player"
    // Check if this player has creatures attacking them
    const battlefield = game.state?.battlefield || [];
    const isBeingAttacked = listAttackersAgainstDefender(battlefield, playerId).length > 0;
    
    // Check if player has potential blockers (untapped creatures)
    const hasPotentialBlockers = battlefield.some((perm: any) => {
      if (!perm || perm.controller !== playerId) return false;
      if (perm.tapped) return false;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      return typeLine.includes('creature');
    });
    
    const isDefendingPlayer = isBeingAttacked && hasPotentialBlockers;
    
    // For human players, only auto-pass if they have NO valid responses
    if (!priorityPlayer.isAI) {
      // For the active player (turn player), check BOTH canAct and canRespond
      // They need to be able to hold priority to cast instants on their own turn
      // For non-active players, only check canRespond (instant-speed responses)
      const isActivePlayer = playerId === turnPlayer;
      const hasActions = isActivePlayer 
        ? (canAct(game as any, playerId) || canRespond(game as any, playerId))
        : canRespond(game as any, playerId);

      const stateAny = game.state as any;
      const stackLen = Array.isArray(game.state?.stack) ? game.state.stack.length : 0;
      const autoPassForTurn = stateAny.autoPassForTurn?.[playerId] || false;
      const loopStackDrain = stateAny.loopShortcutStackDrain?.[playerId] === true;
      const autoPassEnabled = stateAny.autoPassPlayers instanceof Set
        ? stateAny.autoPassPlayers.has(playerId)
        : false;
      const bypassIdleForStack = shouldBypassIdleForNonEmptyStack({
        stackLen,
        autoPassEnabled,
        loopStackDrain,
        autoPassForTurn,
        state: game.state,
        playerId: String(playerId),
      });
      
      if (hasActions && !triggerAutoPassReason && !bypassIdleForStack) {
        debug(2, `[doAutoPass] Skipping auto-pass for human player ${playerId} (${isActivePlayer ? 'active' : 'non-active'}) - they have valid actions available`);
        return; // Player has options, don't auto-pass
      }

      if (hasActions && (triggerAutoPassReason || bypassIdleForStack)) {
        debug(2, `[doAutoPass] Auto-passing for human player ${playerId} despite valid actions because ${triggerAutoPassReason || `stack drain (len=${stackLen})`} applies`);
      }
      
      debug(2, `[doAutoPass] Auto-passing for human player ${playerId} (${isActivePlayer ? 'active' : 'non-active'}) - no valid actions available`);
      // Fall through to auto-pass since player has no valid responses
    }
    
    // IMPORTANT: Don't auto-pass during DECLARE_BLOCKERS step for defending players
    // Per Rule 509, the defending player must be given the opportunity to declare blockers
    // This is a turn-based action that doesn't use the stack
    // Only prevent auto-pass if player is being attacked AND has untapped creatures to block with
    
    if ((currentStep === 'DECLARE_BLOCKERS' || currentStep.includes('BLOCKERS')) && isDefendingPlayer) {
      debug(2, `[doAutoPass] Skipping auto-pass for ${playerId} during DECLARE_BLOCKERS step - player has potential blockers`);
      return;
    }

    // game.passPriority may not exist on some wrappers; call defensively
    let res: any = null;
    if (typeof (game as any).passPriority === "function") {
      res = (game as any).passPriority(playerId, true); // true = isAutoPass
    } else if (typeof (game as any).nextPass === "function") {
      res = (game as any).nextPass(playerId);
    } else {
      debugWarn(1, 
        "doAutoPass: game.passPriority not implemented for this game wrapper"
      );
      return;
    }

    const changed = Boolean(res && (res.changed ?? true));
    const resolvedNow = Boolean(res && (res.resolvedNow ?? false));
    if (!changed) return;

    appendGameEvent(game, gameId, "passPriority", { by: playerId, reason });

    if (resolvedNow) {
      const deferredMox = tryQueueMoxDiamondBeforeStackResolve(game);
      if (!deferredMox && persistAndResolveTopOfStack(game, gameId)) {
        runPostResolutionPermanentPromptChecks(io, game, gameId);
        debug(2, `[doAutoPass] Stack resolved for game ${gameId}`);
      }
      try {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: "Top of stack resolved automatically.",
          ts: Date.now(),
        });
      } catch (err) {
        debugWarn(1, "doAutoPass: failed to emit chat", err);
      }
    }

    broadcastGame(io, game, gameId);
  } catch (err) {
    debugWarn(1, "doAutoPass: unexpected error", err);
  }
}
