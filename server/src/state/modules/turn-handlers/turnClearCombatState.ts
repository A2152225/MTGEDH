// server/src/state/modules/turn-handlers/turnClearCombatState.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: clearCombatState (Rule 506.4 leave-combat cleanup).
// Public entry symbols: clearCombatState.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { debug, debugWarn } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Clear combat state from all permanents on the battlefield.
 * Should be called when transitioning out of combat phase.
 * Rule 506.4: When combat ends, remove all combat-related states from permanents.
 */
export function clearCombatState(ctx: GameContext) {
  try {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return;
    
    let clearedCount = 0;
    for (const permanent of battlefield) {
      if (!permanent) continue;
      
      // Clear attacking state
      if (permanent.attacking !== undefined) {
        delete permanent.attacking;
        clearedCount++;
      }
      
      // Clear blocking state  
      if (permanent.blocking !== undefined) {
        delete permanent.blocking;
        clearedCount++;
      }
      
      // Clear blockedBy state
      if (permanent.blockedBy !== undefined) {
        delete permanent.blockedBy;
        clearedCount++;
      }
      
      // Clear combat damage received this turn (optional - depends on implementation)
      if (permanent.combatDamageThisTurn !== undefined) {
        delete permanent.combatDamageThisTurn;
      }
    }
    
    // Clear combat state on game state
    if ((ctx as any).state.combat !== undefined) {
      delete (ctx as any).state.combat;
    }
    
    if (clearedCount > 0) {
      debug(2, `${ts()} [clearCombatState] Cleared combat state from ${clearedCount} permanents`);
    }
  } catch (err) {
    debugWarn(1, `${ts()} clearCombatState failed:`, err);
  }
}
