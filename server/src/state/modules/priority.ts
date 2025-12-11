import type { PlayerID, PlayerRef } from "../../../../shared/src";
import type { GameContext } from "../context";
import { canAct, canRespond } from "./can-respond";

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

export function passPriority(ctx: GameContext, playerId: PlayerID): { changed: boolean; resolvedNow: boolean; advanceStep: boolean } {
  const { state, passesInRow, bumpSeq } = ctx;
  if (state.priority !== playerId) return { changed: false, resolvedNow: false, advanceStep: false };
  const active = activePlayersClockwise(ctx);
  const n = active.length;
  if (n === 0) return { changed: false, resolvedNow: false, advanceStep: false };
  
  // Track that this player passed priority
  const stateAny = state as any;
  if (!stateAny.priorityPassedBy || !(stateAny.priorityPassedBy instanceof Set)) {
    stateAny.priorityPassedBy = new Set<string>();
  }
  stateAny.priorityPassedBy.add(playerId);
  
  // If the player who initiated skipToPhase just manually passed, clear the flag
  // This allows auto-pass to resume normally after they've had their priority window
  if (stateAny.justSkippedToPhase && stateAny.justSkippedToPhase.playerId === playerId) {
    const current = normalizePhaseStep(stateAny.phase, stateAny.step);
    const justSkipped = normalizePhaseStep(
      stateAny.justSkippedToPhase.phase,
      stateAny.justSkippedToPhase.step
    );
    
    // Only clear if we're still in the phase/step they skipped to
    if (current.phase === justSkipped.phase && current.step === justSkipped.step) {
      console.log(`[passPriority] Clearing justSkippedToPhase: initiator ${playerId} manually passed at ${current.step}`);
      delete stateAny.justSkippedToPhase;
    }
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
      
      // Don't auto-pass here - we just resolved the stack after all players passed.
      // The turn player will get a chance to respond to the new board state.
    } else {
      // Not all players have passed yet, advance priority clockwise
      state.priority = advancePriorityClockwise(ctx, playerId);
      
      // Iteratively auto-pass players who cannot respond
      const result = autoPassLoop(ctx, active);
      if (result.allPassed && result.resolved) {
        // All players auto-passed and stack was resolved
        resolvedNow = true;
        passesInRow.value = 0;
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
      
      // Iteratively auto-pass players who cannot respond
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
 */
function autoPassLoop(ctx: GameContext, active: PlayerRef[]): { allPassed: boolean; resolved: boolean } {
  const { state } = ctx;
  const stateAny = state as any;
  const autoPassPlayers = stateAny.autoPassPlayers || new Set();
  const turnPlayer = state.turnPlayer as PlayerID;
  
  console.log(`[priority] autoPassLoop starting - active players: ${active.map(p => p.id).join(', ')}, autoPassEnabled: ${Array.from(autoPassPlayers).join(', ')}, currentPriority: ${state.priority}, turnPlayer: ${turnPlayer}`);
  
  // Check if we just arrived at this phase via skipToPhase
  // If so, give the player who initiated the skip at least one priority window
  // This prevents auto-passing through a phase the player explicitly navigated to
  const justSkipped = stateAny.justSkippedToPhase;
  if (justSkipped && justSkipped.playerId && justSkipped.phase && justSkipped.step) {
    const current = normalizePhaseStep(stateAny.phase, stateAny.step);
    const skipped = normalizePhaseStep(justSkipped.phase, justSkipped.step);
    
    // Check if we're still in the phase/step that was just skipped to
    if (current.phase === skipped.phase && current.step === skipped.step) {
      const skipInitiator = justSkipped.playerId;
      
      // If the player who skipped hasn't passed yet, don't auto-pass them
      if (state.priority === skipInitiator && !stateAny.priorityPassedBy.has(skipInitiator)) {
        console.log(`[priority] autoPassLoop - stopping: player ${skipInitiator} just skipped to ${current.step}, giving them priority window`);
        return { allPassed: false, resolved: false };
      }
      
      // If the skip initiator has passed, clear the flag so auto-pass can resume
      if (stateAny.priorityPassedBy.has(skipInitiator)) {
        console.log(`[priority] autoPassLoop - clearing justSkippedToPhase: initiator ${skipInitiator} has passed`);
        delete stateAny.justSkippedToPhase;
      }
    } else {
      // We've moved to a different phase/step, clear the flag
      console.log(`[priority] autoPassLoop - clearing justSkippedToPhase: moved from ${skipped.step} to ${current.step}`);
      delete stateAny.justSkippedToPhase;
    }
  }
  
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
    
    // Check if auto-pass is enabled for current player
    if (!autoPassPlayers.has(currentPlayer)) {
      // Auto-pass not enabled, stop here
      console.log(`[priority] autoPassLoop - stopping at ${currentPlayer}: auto-pass not enabled`);
      return { allPassed: false, resolved: false };
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
    const isMainPhase = currentStep === 'MAIN1' || currentStep === 'MAIN2' || currentStep === 'MAIN';
    const stackIsEmpty = !state.stack || state.stack.length === 0;
    
    // CRITICAL: Never auto-pass the active player (turn player) during their own turn
    // unless they have explicitly enabled "auto-pass for rest of turn" (checked via autoPassForTurn flag)
    // 
    // The regular auto-pass toggle is meant for non-active players to skip priority on opponents' turns.
    // The turn player should ALWAYS be given a chance to act in each step/phase during their turn
    // so they can play lands, cast spells, activate abilities, etc.
    // 
    // This is a fundamental MTG rule - the active player must receive priority and have
    // the opportunity to take actions before the game advances.
    const autoPassForTurn = stateAny.autoPassForTurn?.[currentPlayer] || false;
    if (isActivePlayer && !autoPassForTurn) {
      console.log(`[priority] autoPassLoop - stopping at ${currentPlayer}: active player on their own turn (must manually pass or enable auto-pass for rest of turn)`);
      return { allPassed: false, resolved: false };
    }
    
    const playerCanAct = isActivePlayer 
      ? canAct(ctx, currentPlayer)      // Active player: check all actions (instant + sorcery speed)
      : canRespond(ctx, currentPlayer);  // Non-active: only check instant-speed responses
    
    console.log(`[priority] autoPassLoop - checking ${currentPlayer} (${isActivePlayer ? 'ACTIVE' : 'non-active'}): canAct=${playerCanAct}, stack.length=${state.stack.length}, step=${currentStep}`);
    
    if (playerCanAct) {
      // Player can act, stop here
      console.log(`[priority] autoPassLoop - stopping at ${currentPlayer}: player can act`);
      return { allPassed: false, resolved: false };
    }
    
    // Player cannot act - auto-pass
    console.log(`[priority] Auto-passing for ${currentPlayer} - no available actions`);
    stateAny.priorityPassedBy.add(currentPlayer);
    
    // Advance to next player
    state.priority = advancePriorityClockwise(ctx, currentPlayer);
  }
  
  // Safety fallback - should never reach here
  console.warn('[priority] Auto-pass loop exceeded maximum iterations');
  return { allPassed: false, resolved: false };
}

export function setTurnDirection(ctx: GameContext, dir: 1 | -1) {
  ctx.state.turnDirection = dir;
  ctx.bumpSeq();
}