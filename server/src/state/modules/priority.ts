import type { PlayerID, PlayerRef } from "../../../../shared/src";
import type { GameContext } from "../context";
import { canRespond } from "./can-respond";

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
      autoPassLoop(ctx, active);
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
        advanceStep = true;
        resolvedNow = result.resolved;
      }
    }
  }
  
  bumpSeq();
  return { changed: true, resolvedNow, advanceStep };
}

/**
 * Iteratively auto-pass for players who cannot respond
 * Stops when we find a player who can respond OR all players have passed
 */
function autoPassLoop(ctx: GameContext, active: PlayerRef[]): { allPassed: boolean; resolved: boolean } {
  const { state } = ctx;
  const stateAny = state as any;
  const autoPassPlayers = stateAny.autoPassPlayers || new Set();
  
  let iterations = 0;
  const maxIterations = active.length * 2; // Safety limit
  
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
      return { allPassed: false, resolved: false };
    }
    
    // Check if player can respond
    if (canRespond(ctx, currentPlayer)) {
      // Player can respond, stop here
      return { allPassed: false, resolved: false };
    }
    
    // Player cannot respond - auto-pass
    console.log(`[priority] Auto-passing for ${currentPlayer} - no available responses`);
    stateAny.priorityPassedBy.add(currentPlayer);
    
    // Advance to next player
    state.priority = advancePriorityClockwise(ctx, currentPlayer);
  }
  
  // Safety fallback - should never reach here
  console.warn('[priority] Auto-pass loop exceeded maximum iterations');
  return { allPassed: false, resolved: false };
}

/**
 * Auto-pass priority for a player if they cannot respond
 * 
 * @param ctx Game context
 * @param playerId Player to check and potentially auto-pass
 * @returns true if auto-pass was applied, false otherwise
 */
export function autoPassIfCannotRespond(ctx: GameContext, playerId: PlayerID): boolean {
  const { state } = ctx;
  
  // Check if auto-pass is enabled for this player
  const autoPassPlayers = (state as any).autoPassPlayers || new Set();
  if (!autoPassPlayers.has(playerId)) {
    return false; // Auto-pass not enabled for this player
  }
  
  // Check if player can respond
  if (canRespond(ctx, playerId)) {
    return false; // Player can respond, don't auto-pass
  }
  
  // Player cannot respond - auto-pass priority
  console.log(`[priority] Auto-passing for ${playerId} - no available responses`);
  
  // Call passPriority to advance
  passPriority(ctx, playerId);
  
  return true;
}

export function setTurnDirection(ctx: GameContext, dir: 1 | -1) {
  ctx.state.turnDirection = dir;
  ctx.bumpSeq();
}