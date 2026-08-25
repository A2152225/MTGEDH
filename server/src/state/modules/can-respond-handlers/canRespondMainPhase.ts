// server/src/state/modules/can-respond-handlers/canRespondMainPhase.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: isInMainPhase.
// Public entry symbols: isInMainPhase.

import type { GameContext } from '../../context.js';
import { debugWarn } from '../../../utils/debug.js';

/**
 * Check if game is currently in a main phase
 */
export function isInMainPhase(ctx: GameContext): boolean {
  try {
    const step = (ctx.state as any).step;
    if (!step) return false;
    
    // Main phases are MAIN_1 (pre-combat) and MAIN_2 (post-combat)
    const stepStr = String(step).toUpperCase();
    return stepStr === 'MAIN_1' || stepStr === 'MAIN_2' || stepStr === 'MAIN' || stepStr.includes('MAIN');
  } catch (err) {
    debugWarn(1, "[isInMainPhase] Error:", err);
    // Default to true to be conservative (don't auto-pass if uncertain)
    return true;
  }
}
