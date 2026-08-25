// server/src/state/modules/turn-handlers/turnScheduledStepsAndExtras.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: scheduled-step queues, extra turns (Rule 500.7), extra
// combat phases.
// Public entry symbols: scheduleStepsAfterCurrent, scheduleStepsAtEndOfTurn,
// clearScheduledSteps, getScheduledSteps, removeScheduledSteps, addExtraTurn,
// getExtraTurns, addExtraCombat, hasExtraCombat, consumeExtraCombat,
// skipExtraTurn.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { debug, debugWarn } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/* Simple scheduled-steps support (lightweight queue stored on ctx) */
export function scheduleStepsAfterCurrent(ctx: any, steps: any[]) {
  try {
    if (!ctx) return;
    ctx._scheduledSteps = ctx._scheduledSteps || [];
    if (!Array.isArray(steps)) return;
    ctx._scheduledSteps.push(...steps);
  } catch (err) {
    debugWarn(1, `${ts()} scheduleStepsAfterCurrent failed:`, err);
  }
}

export function scheduleStepsAtEndOfTurn(ctx: any, steps: any[]) {
  try {
    if (!ctx) return;
    ctx._scheduledEndOfTurnSteps = ctx._scheduledEndOfTurnSteps || [];
    if (!Array.isArray(steps)) return;
    ctx._scheduledEndOfTurnSteps.push(...steps);
  } catch (err) {
    debugWarn(1, `${ts()} scheduleStepsAtEndOfTurn failed:`, err);
  }
}

export function clearScheduledSteps(ctx: any) {
  try {
    if (!ctx) return;
    ctx._scheduledSteps = [];
    ctx._scheduledEndOfTurnSteps = [];
  } catch (err) {
    debugWarn(1, `${ts()} clearScheduledSteps failed:`, err);
  }
}

export function getScheduledSteps(ctx: any) {
  try {
    return {
      afterCurrent: Array.isArray(ctx._scheduledSteps)
        ? ctx._scheduledSteps.slice()
        : [],
      endOfTurn: Array.isArray(ctx._scheduledEndOfTurnSteps)
        ? ctx._scheduledEndOfTurnSteps.slice()
        : [],
    };
  } catch (err) {
    return { afterCurrent: [], endOfTurn: [] };
  }
}

export function removeScheduledSteps(ctx: any, steps: any[]) {
  try {
    if (!ctx || !Array.isArray(steps)) return;
    ctx._scheduledSteps = (ctx._scheduledSteps || []).filter(
      (s: any) => !steps.includes(s)
    );
    ctx._scheduledEndOfTurnSteps = (
      ctx._scheduledEndOfTurnSteps || []
    ).filter((s: any) => !steps.includes(s));
  } catch (err) {
    debugWarn(1, `${ts()} removeScheduledSteps failed:`, err);
  }
}

/**
 * Add an extra turn for a player (Rule 500.7)
 * Extra turns are taken in LIFO order - the most recently added turn is taken first.
 * 
 * @param ctx - Game context
 * @param playerId - The player who will take the extra turn
 * @param source - Optional source description (e.g., "Time Warp", "Nexus of Fate")
 */
export function addExtraTurn(ctx: GameContext, playerId: string, source?: string): void {
  try {
    const state = (ctx as any).state;
    if (!state) return;
    
    // Initialize extra turns array if needed
    state.extraTurns = state.extraTurns || [];
    
    // Add the extra turn to the front (LIFO order)
    const turnNumber = state.turnNumber || 0;
    state.extraTurns.unshift({
      playerId,
      afterTurnNumber: turnNumber,
      source: source || 'Unknown',
      createdAt: Date.now(),
    });
    
    debug(2, `${ts()} [addExtraTurn] Extra turn added for ${playerId} from "${source || 'Unknown'}" (current turn: ${turnNumber})`);
    ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, `${ts()} addExtraTurn failed:`, err);
  }
}

/**
 * Get pending extra turns for display/debugging
 */
export function getExtraTurns(ctx: GameContext): Array<{ playerId: string; source?: string }> {
  try {
    const state = (ctx as any).state;
    return (state?.extraTurns || []).map((et: any) => ({
      playerId: et.playerId,
      source: et.source,
    }));
  } catch (err) {
    return [];
  }
}

/**
 * Add an extra combat phase to the current turn
 * Used by cards like Aurelia, Combat Celebrant, Hellkite Charger, etc.
 * 
 * @param ctx - Game context
 * @param source - Optional source description (e.g., "Aurelia, the Warleader")
 * @param untapAttackers - Whether to untap attacking creatures (Aurelia does this)
 */
export function addExtraCombat(ctx: GameContext, source?: string, untapAttackers?: boolean): void {
  try {
    const state = (ctx as any).state;
    if (!state) return;
    
    // Initialize extra combats array if needed
    state.extraCombats = state.extraCombats || [];
    
    // Track which combat phase we're on for this turn
    state.combatNumber = (state.combatNumber || 1);
    
    // Add the extra combat phase
    state.extraCombats.push({
      source: source || 'Unknown',
      untapAttackers: untapAttackers || false,
      createdAt: Date.now(),
    });
    
    debug(2, `${ts()} [addExtraCombat] Extra combat added from "${source || 'Unknown'}" (untap: ${untapAttackers})`);
    ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, `${ts()} addExtraCombat failed:`, err);
  }
}

/**
 * Check if there are pending extra combat phases
 */
export function hasExtraCombat(ctx: GameContext): boolean {
  const state = (ctx as any).state;
  return (state?.extraCombats?.length || 0) > 0;
}

/**
 * Consume an extra combat phase and return its details
 */
export function consumeExtraCombat(ctx: GameContext): { source?: string; untapAttackers?: boolean } | null {
  try {
    const state = (ctx as any).state;
    if (!state?.extraCombats?.length) return null;
    
    const extraCombat = state.extraCombats.shift();
    state.combatNumber = (state.combatNumber || 1) + 1;
    
    debug(2, `${ts()} [consumeExtraCombat] Starting extra combat from "${extraCombat.source}" (combat #${state.combatNumber})`);
    
    // If untapAttackers is true, untap all creatures that attacked
    if (extraCombat.untapAttackers) {
      const battlefield = state.battlefield || [];
      for (const perm of battlefield) {
        if (perm && perm.attacking) {
          perm.tapped = false;
          debug(2, `${ts()} [consumeExtraCombat] Untapped ${perm.card?.name || perm.id} for extra combat`);
        }
      }
    }
    
    ctx.bumpSeq();
    return extraCombat;
  } catch (err) {
    debugWarn(1, `${ts()} consumeExtraCombat failed:`, err);
    return null;
  }
}

/**
 * Skip a player's extra turn (for effects like Discontinuity or Stranglehold)
 * @param ctx - Game context
 * @param playerId - The player whose extra turn should be skipped
 * @returns true if an extra turn was skipped
 */
export function skipExtraTurn(ctx: GameContext, playerId: string): boolean {
  try {
    const state = (ctx as any).state;
    if (!state?.extraTurns?.length) return false;
    
    const idx = state.extraTurns.findIndex((et: any) => et.playerId === playerId);
    if (idx >= 0) {
      const skipped = state.extraTurns.splice(idx, 1)[0];
      debug(2, `${ts()} [skipExtraTurn] Skipped extra turn for ${playerId} from "${skipped.source || 'Unknown'}"`);
      ctx.bumpSeq();
      return true;
    }
    return false;
  } catch (err) {
    debugWarn(1, `${ts()} skipExtraTurn failed:`, err);
    return false;
  }
}
