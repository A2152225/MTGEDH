import type { PlayerID, PlayerRef } from "../../../../shared/src";
import type { GameContext } from "../context";
import { canAct, canRespond } from "./can-respond";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { ResolutionQueueManager, ResolutionQueueEvent } from "../resolution/ResolutionQueueManager.js";
import type { ResolutionStep } from "../resolution/types.js";
import { getPendingInteractions } from "./turn.js";

/**
 * Normalize phase and step strings for comparison.
 * Phase is lowercased, step is uppercased.
 */
function normalizePhaseStep(phase: string, step: string): { phase: string; step: string } {
  return {
    phase: String(phase || '').toLowerCase(),
    step: String(step || '').toUpperCase(),
  };
}

/**
 * Check if we're at the phase/step that the player skipped to
 */
function isAtSkipTarget(currentPhase: string, currentStep: string, skipPhase: string, skipStep: string): boolean {
  const current = normalizePhaseStep(currentPhase, currentStep);
  const target = normalizePhaseStep(skipPhase, skipStep);
  return current.phase === target.phase && current.step === target.step;
}

function activePlayersClockwise(ctx: GameContext): PlayerRef[] {
  const { state, inactive } = ctx;
  return (state.players as any as PlayerRef[])
    .filter(p => !inactive.has(p.id))
    .sort((a, b) => a.seat - b.seat);
}

function advancePriorityClockwise(ctx: GameContext, from: PlayerID): PlayerID {
  const active = activePlayersClockwise(ctx);
  const n = active.length;
  if (n === 0) return from;
  const idx = active.findIndex(p => p.id === from);
  const step = ctx.state.turnDirection === -1 ? -1 : 1;
  const nextIdx = ((idx >= 0 ? idx : 0) + step + n) % n;
  return active[nextIdx].id as PlayerID;
}

export function passPriority(ctx: GameContext, playerId: PlayerID, isAutoPass?: boolean): { changed: boolean; resolvedNow: boolean; advanceStep: boolean } {
  const { state, passesInRow, bumpSeq } = ctx;
  
  // CRITICAL: During resolution (MTG Rule 608.2), priority is null
  // No one can pass priority because priority doesn't exist during resolution
  if (state.priority === null) {
    debug(1, `[priority] Cannot pass priority - currently in resolution mode (priority doesn't exist per Rule 608.2)`);
    return { changed: false, resolvedNow: false, advanceStep: false };
  }
  
  if (state.priority !== playerId) return { changed: false, resolvedNow: false, advanceStep: false };
  const active = activePlayersClockwise(ctx);
  const n = active.length;
  if (n === 0) return { changed: false, resolvedNow: false, advanceStep: false };
  
  // CRITICAL FIX: Check if there are pending resolution steps that need to be completed
  // before priority can be passed. This enforces MTG Rule 608.2: "Players do not receive
  // priority while a spell or ability is resolving." This blocks priority passing when
  // ANY player (not just the current player) has pending resolution steps like bounce land
  // choices, Join Forces decisions, etc. The game must wait for all resolution steps to
  // complete before priority can be passed.
  // 
  // NOTE: This check is redundant with the priority === null check above (which is now the
  // primary mechanism), but we keep it as defense-in-depth.
  const gameId = ctx.gameId;
  const pendingSummary = ResolutionQueueManager.getPendingSummary(gameId);
  if (pendingSummary.hasPending) {
    const pendingTypes = pendingSummary.pendingTypes.join(', ');
    debug(1, `[priority] Cannot pass priority - pending resolution steps: ${pendingTypes}`);
    // Don't change state, don't bump sequence - just block the priority pass
    return { changed: false, resolvedNow: false, advanceStep: false };
  }
  
  // Track that this player passed priority
  const stateAny = state as any;
  if (!stateAny.priorityPassedBy || !(stateAny.priorityPassedBy instanceof Set)) {
    stateAny.priorityPassedBy = new Set<string>();
  }
  stateAny.priorityPassedBy.add(playerId);

  // Phase navigator metadata: once the initiating player manually passes,
  // the special protection should end (tests expect this behavior).
  if (!isAutoPass && stateAny.justSkippedToPhase?.playerId === playerId) {
    delete stateAny.justSkippedToPhase;
  }
  
  let resolvedNow = false;
  let advanceStep = false;
  
  // Check if all active players have passed priority
  const allPassed = active.every(p => stateAny.priorityPassedBy.has(p.id));
  
  if (state.stack.length > 0) {
    passesInRow.value++;
    if (passesInRow.value >= n || allPassed) {
      resolvedNow = true;
      passesInRow.value = 0;
      stateAny.priorityPassedBy = new Set<string>(); // Reset tracking
      // After stack resolution, priority goes back to the active player (turn player)
      // per MTG rule 117.3b - "After a spell or ability resolves, the active player receives priority"
      state.priority = state.turnPlayer as PlayerID;
      
      // IMPORTANT: After stack resolution, check if active player can act
      // If not, run auto-pass loop to advance priority to next player who can act
      // This prevents the game from getting stuck after resolving spells/abilities
      // when the active player has no responses available
      const result = autoPassLoop(ctx, active);
      if (result.allPassed) {
        // All players auto-passed after stack resolution
        if (result.resolved) {
          // Another item was resolved from stack
          resolvedNow = true;
        } else {
          // Empty stack now - advance step
          advanceStep = true;
        }
      }
    } else {
      // Not all players have passed yet, advance priority clockwise
      state.priority = advancePriorityClockwise(ctx, playerId);
      
      // Run autoPassLoop ONLY if this is an auto-pass (not a manual pass)
      // This allows the system to chain auto-passes when players have no actions,
      // but prevents aggressive auto-passing when a player manually clicks "Pass Priority"
      if (isAutoPass) {
        const result = autoPassLoop(ctx, active);
        if (result.allPassed && result.resolved) {
          // All players auto-passed and stack was resolved
          resolvedNow = true;
          passesInRow.value = 0;
        }
      }
    }
  } else {
    passesInRow.value = 0;
    // If all players passed with empty stack, advance step
    if (allPassed) {
      advanceStep = true;
      stateAny.priorityPassedBy = new Set<string>(); // Reset tracking
      // Priority stays with the active player (turn player) for the next step
      state.priority = state.turnPlayer as PlayerID;
      // Note: Don't auto-pass here because we're advancing to the next step.
      // The step advancement logic will give priority and can check auto-pass there.
    } else {
      // Not all players have passed yet, advance priority clockwise
      state.priority = advancePriorityClockwise(ctx, playerId);
      
      // Run autoPassLoop ONLY if this is an auto-pass (not a manual pass)
      // This allows the system to chain auto-passes when players have no actions,
      // but prevents aggressive auto-passing when a player manually clicks "Pass Priority"
      if (isAutoPass) {
        const result = autoPassLoop(ctx, active);
        if (result.allPassed) {
          // All players have now passed via auto-pass
          if (result.resolved) {
            // Stack was resolved
            resolvedNow = true;
          } else {
            // Empty stack - advance step
            advanceStep = true;
          }
        }
      }
    }
  }
  
  bumpSeq();
  return { changed: true, resolvedNow, advanceStep };
}

/**
 * Iteratively auto-pass for players who cannot act
 * Stops when we find a player who can act OR all players have passed
 * 
 * Uses canAct() for all players - it checks both instant-speed AND sorcery-speed actions.
 * For non-active players, canAct will return false for sorcery-speed actions (not their main phase)
 * but will still check instant-speed responses correctly.
 * 
 * @export Exported so it can be called from turn.ts after granting priority in nextStep
 */
export function tryAutoPass(ctx: GameContext): { allPassed: boolean; resolved: boolean; advanceStep: boolean } {
  const active = activePlayersClockwise(ctx);
  const result = autoPassLoop(ctx, active);
  
  // If all players passed, determine whether to resolve stack or advance step
  if (result.allPassed) {
    if (result.resolved) {
      // Stack was resolved
      return { allPassed: true, resolved: true, advanceStep: false };
    } else {
      // Empty stack - should advance step
      return { allPassed: true, resolved: false, advanceStep: true };
    }
  }
  
  return { allPassed: false, resolved: false, advanceStep: false };
}

/**
 * Iteratively auto-pass for players who cannot act
 * Stops when we find a player who can act OR all players have passed
 * 
 * Uses canAct() for all players - it checks both instant-speed AND sorcery-speed actions.
 * For non-active players, canAct will return false for sorcery-speed actions (not their main phase)
 * but will still check instant-speed responses correctly.
 */
function autoPassLoop(ctx: GameContext, active: PlayerRef[]): { allPassed: boolean; resolved: boolean } {
  const { state } = ctx;
  const stateAny = state as any;
  const autoPassPlayers = stateAny.autoPassPlayers || new Set();
  const turnPlayer = state.turnPlayer as PlayerID;
  
  // Ensure priorityPassedBy is initialized
  if (!stateAny.priorityPassedBy || !(stateAny.priorityPassedBy instanceof Set)) {
    stateAny.priorityPassedBy = new Set<string>();
  }
  
  // CRITICAL FIX: Check if there are pending resolution steps
  // If so, don't auto-pass anyone - wait for the resolution steps to complete.
  // This enforces MTG Rule 608.2: "Players do not receive priority while a spell
  // or ability is resolving." Auto-passing would effectively grant priority, which
  // violates this rule when resolution steps (choices) are still pending.
  const gameId = ctx.gameId;
  const pendingSummary = ResolutionQueueManager.getPendingSummary(gameId);
  if (pendingSummary.hasPending) {
    const pendingTypes = pendingSummary.pendingTypes.join(', ');
    debug(2, `[priority] autoPassLoop - blocking due to pending resolution steps: ${pendingTypes}`);
    return { allPassed: false, resolved: false };
  }
  
  // CRITICAL FIX: Check for pending blocker declarations
  // During DECLARE_BLOCKERS step, we must wait for all defending players to declare blockers
  // before auto-passing anyone. This prevents the auto-pass loop from cycling infinitely
  // when the active player (attacker) passes but defenders haven't declared yet.
  const pendingInteractions = getPendingInteractions(ctx);
  if (pendingInteractions.hasPending) {
    const pendingTypes = pendingInteractions.pendingTypes.join(', ');
    debug(2, `[priority] autoPassLoop - blocking due to pending interactions: ${pendingTypes}`);
    return { allPassed: false, resolved: false };
  }
  
  // IMPORTANT: Do not run auto-pass loop during pre_game phase
  // During pre_game, players are selecting decks, commanders, and making mulligan decisions.
  // Auto-pass should not interfere with these setup steps.
  const currentPhase = String(stateAny.phase || '').toLowerCase();
  if (currentPhase === 'pre_game') {
    debug(2, `[priority] autoPassLoop - in pre_game phase, skipping auto-pass`);
    return { allPassed: false, resolved: false };
  }
  
  debug(1, `[priority] autoPassLoop starting - active players: ${active.map(p => p.id).join(', ')}, autoPassEnabled: ${Array.from(autoPassPlayers).join(', ')}, currentPriority: ${state.priority}, turnPlayer: ${turnPlayer}`);
  
  
  let iterations = 0;
  // Safety limit: Each player can pass at most once per priority round.
  // We add +1 to account for checking if we've cycled back to a player who already passed.
  // This prevents infinite loops while allowing legitimate auto-pass chains.
  const maxIterations = active.length + 1;
  
  while (iterations < maxIterations) {
    iterations++;
    
    const currentPlayer = state.priority;
    
    // Check if all players have now passed
    const allPassed = active.every(p => stateAny.priorityPassedBy.has(p.id));
    if (allPassed) {
      // All players have passed - resolve or advance
      if (state.stack.length > 0) {
        // Resolve stack
        stateAny.priorityPassedBy = new Set<string>();
        state.priority = state.turnPlayer as PlayerID;
        return { allPassed: true, resolved: true };
      } else {
        // Advance step
        stateAny.priorityPassedBy = new Set<string>();
        state.priority = state.turnPlayer as PlayerID;
        return { allPassed: true, resolved: false };
      }
    }
    
    // If current player has already passed, advance to next
    if (stateAny.priorityPassedBy.has(currentPlayer)) {
      state.priority = advancePriorityClockwise(ctx, currentPlayer);
      continue;
    }
    
    // Check if player has claimed priority (clicked "Take Action")
    // If so, don't auto-pass them - they want to take an action
    if (!stateAny.priorityClaimed) {
      stateAny.priorityClaimed = new Set<string>();
    }
    if (stateAny.priorityClaimed.has(currentPlayer)) {
      debug(2, `[priority] autoPassLoop - stopping at ${currentPlayer}: player claimed priority (wants to take action)`);
      return { allPassed: false, resolved: false };
    }
    
    // Check if auto-pass is enabled for current player
    if (!autoPassPlayers.has(currentPlayer)) {
      // Auto-pass not enabled, stop here
      debug(2, `[priority] autoPassLoop - stopping at ${currentPlayer}: auto-pass not enabled`);
      return { allPassed: false, resolved: false };
    }
    
    // Check if player has explicitly enabled "auto-pass for rest of turn"
    const autoPassForTurn = stateAny.autoPassForTurn?.[currentPlayer] || false;
    
    // If player has "Auto-Pass Rest of Turn" enabled, skip all ability checks
    // and auto-pass them through everything
    if (autoPassForTurn) {
      debug(2, `[priority] Auto-passing for ${currentPlayer} - auto-pass for rest of turn enabled`);
      stateAny.priorityPassedBy.add(currentPlayer);
      state.priority = advancePriorityClockwise(ctx, currentPlayer);
      continue;
    }
    
    // Check if player can take any action
    // Use different checks for active vs non-active players:
    // - Active player (turn player): use canAct() which checks ALL actions (instant-speed + sorcery-speed)
    // - Non-active players: use canRespond() which ONLY checks instant-speed responses
    // 
    // This prevents auto-pass false positives where non-active players are prompted for priority
    // even though they only have lands/sorceries (which they can't play on opponent's turn)
    const isActivePlayer = currentPlayer === turnPlayer;
    const currentStep = String(stateAny.step || '').toUpperCase();
    
    const playerCanAct = isActivePlayer 
      ? canAct(ctx, currentPlayer)      // Active player: check all actions (instant + sorcery speed)
      : canRespond(ctx, currentPlayer);  // Non-active: only check instant-speed responses
    
    debug(2, `[priority] autoPassLoop - checking ${currentPlayer} (${isActivePlayer ? 'ACTIVE' : 'non-active'}): canAct=${playerCanAct}, stack.length=${state.stack.length}, step=${currentStep}`);
    
    // Check if the current player used phase navigator and we're AT the target phase/step
    // If so, give them priority at this specific step (they explicitly navigated here)
    // This only applies at the TARGET phase, not intermediate steps
    const justSkipped = stateAny.justSkippedToPhase;
    if (justSkipped && justSkipped.playerId === currentPlayer) {
      const isAtTarget = isAtSkipTarget(
        stateAny.phase, 
        stateAny.step, 
        justSkipped.phase, 
        justSkipped.step
      );
      
      if (isAtTarget) {
        debug(2, `[priority] autoPassLoop - stopping at ${currentPlayer}: reached phase navigator target at ${currentStep}`);
        // Clear the flag since we've reached the target and given them priority
        delete stateAny.justSkippedToPhase;
        return { allPassed: false, resolved: false };
      } else {
        // Not at target yet - allow auto-pass to continue moving toward target
        debug(2, `[priority] autoPassLoop - continuing auto-pass for ${currentPlayer}: moving toward phase navigator target (currently at ${currentStep})`);
      }
    }
    
    // For the active player during their own turn:
    // Only auto-pass if canAct() returns false (no legal actions available)
    // 
    // This ensures:
    // 1. Turn player with lands/spells gets priority to act
    // 2. Turn player with no legal moves is auto-passed (e.g., no lands, all spells too expensive)
    if (isActivePlayer && playerCanAct) {
      // Active player can take actions - stop here
      debug(2, `[priority] autoPassLoop - stopping at ${currentPlayer}: active player can act`);
      return { allPassed: false, resolved: false };
    }
    
    // For non-active players, check if they can respond
    if (!isActivePlayer && playerCanAct) {
      // Non-active player can respond - stop here
      debug(2, `[priority] autoPassLoop - stopping at ${currentPlayer}: player can act`);
      return { allPassed: false, resolved: false };
    }
    
    // Player cannot act (or has auto-pass for turn enabled) - auto-pass
    debug(2, `[priority] Auto-passing for ${currentPlayer} - no available actions`);
    stateAny.priorityPassedBy.add(currentPlayer);
    
    // Advance to next player
    state.priority = advancePriorityClockwise(ctx, currentPlayer);
  }
  
  // Safety fallback - should never reach here
  debugWarn(2, '[priority] Auto-pass loop exceeded maximum iterations');
  return { allPassed: false, resolved: false };
}

export function setTurnDirection(ctx: GameContext, dir: 1 | -1) {
  ctx.state.turnDirection = dir;
  ctx.bumpSeq();
}

/**
 * Enter resolution mode: Clear priority per MTG Rule 608.2
 * This is called when the first resolution step is added to an empty queue
 * 
 * Per MTG Rule 608.2: "Players do not receive priority while a spell or ability is resolving"
 * We set state.priority = null to represent that priority doesn't exist during resolution
 */
export function enterResolutionMode(ctx: GameContext): void {
  const { state } = ctx;
  const stateAny = state as any;
  
  // Save who will get priority after resolution completes (always the active player)
  // Per MTG Rule 117.3b: "After a spell or ability finishes resolving, the active player receives priority"
  if (!stateAny._priorityAfterResolution && state.turnPlayer) {
    stateAny._priorityAfterResolution = state.turnPlayer;
    debug(1, `[priority] Entering resolution mode - priority will return to ${state.turnPlayer} after resolution completes`);
  }
  
  // Set priority to null to represent that priority doesn't exist during resolution
  // NOTE: TypeScript types don't allow null, but we use it to correctly represent MTG rules
  // The passPriority function explicitly checks for null and blocks priority passing
  state.priority = null as any;
  
  // Clear any tracked priority passes since priority doesn't exist
  stateAny.priorityPassedBy = new Set<string>();
}

/**
 * Exit resolution mode: Restore priority per MTG Rule 117.3b
 * This is called when the last resolution step completes
 * 
 * Per MTG Rule 117.3b: "After a spell or ability finishes resolving, the active player receives priority"
 */
export function exitResolutionMode(ctx: GameContext): void {
  const { state } = ctx;
  const stateAny = state as any;
  
  // Restore priority to the saved player, or turn player as fallback
  const priorityPlayer = stateAny._priorityAfterResolution || state.turnPlayer;
  
  // Type safety: Validate that we have a valid player ID before restoring
  if (priorityPlayer) {
    state.priority = priorityPlayer as PlayerID;
    debug(1, `[priority] Exiting resolution mode - priority restored to ${priorityPlayer}`);
  } else {
    // Fallback: This shouldn't happen, but if it does, default to turn player
    debugWarn(1, '[priority] exitResolutionMode: No priority player saved, defaulting to turn player');
    state.priority = state.turnPlayer as PlayerID;
  }
  
  // Clear the saved priority holder
  delete stateAny._priorityAfterResolution;
  
  // Reset priority tracking so all players must pass again
  stateAny.priorityPassedBy = new Set<string>();
}
