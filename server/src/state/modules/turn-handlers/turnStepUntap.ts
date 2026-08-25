// server/src/state/modules/turn-handlers/turnStepUntap.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: the leaving-UNTAP run from nextStep() — Rule 502.3 untap
// of the active player's permanents plus Unwinding Clock / Seedborn Muse
// other-players' untap effects.
// Public entry symbols: runTurnStepUntap.
// Called from nextStep() in the parent; not part of the public turn.ts API.
// performUntapStepTurnAction stays in the parent (also used by phase skip).
// Parent helpers used here are passed in so this leaf does not import
// turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { getUntapStepEffects, applyUntapStepEffect } from "../triggered-abilities.js";
import { debug, debugWarn } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Untap-step turn actions from nextStep() when leaving UNTAP (Rule 502.3).
 * nextStep remains the dispatcher and supplies parent untap helpers.
 */
export function runTurnStepUntap(
  ctx: GameContext,
  shouldPerformUntapStepTurnAction: (ctx: GameContext, turnPlayer: string) => boolean,
  untapPermanentsForPlayer: (ctx: GameContext, playerId: string) => void,
): void {
      try {
        const turnPlayer = (ctx as any).state.turnPlayer;
        if (turnPlayer && shouldPerformUntapStepTurnAction(ctx, String(turnPlayer))) {
          // Untap all permanents for the turn player
          untapPermanentsForPlayer(ctx, turnPlayer);
          
          // Apply Unwinding Clock, Seedborn Muse, and similar effects
          // These untap OTHER players' permanents during the turn player's untap step
          const untapEffects = getUntapStepEffects(ctx, turnPlayer);
          for (const effect of untapEffects) {
            const count = applyUntapStepEffect(ctx, effect);
            if (count > 0) {
              debug(2, `${ts()} [nextStep] ${effect.cardName} untapped ${count} permanents for ${effect.controllerId}`);
            }
          }
        } else if (!turnPlayer) {
          debugWarn(2, `${ts()} [nextStep] No turnPlayer set, cannot untap permanents`);
        }
      } catch (err) {
        debugWarn(1, `${ts()} [nextStep] Failed to untap permanents:`, err);
      }
}
