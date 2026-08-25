// server/src/state/modules/turn-handlers/turnStepDrawTurnAction.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: the shouldDraw extra-draw block from nextStep() —
// Rule 504.1 draw turn-based action (base + additional draws) and SBA.
// Public entry symbols: runTurnStepDrawTurnAction.
// nextStep remains the dispatcher. Leaf must not import turn.ts or
// turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { drawCards } from "../zones.js";
import { runSBA } from "../counters_tokens.js";
import { debug, debugWarn } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Draw-step turn-based action from nextStep() when shouldDraw is set.
 * Parent supplies shouldPerformDrawStepTurnAction (Rule 103.8a).
 */
export function runTurnStepDrawTurnAction(
  ctx: GameContext,
  shouldPerformDrawStepTurnAction: (ctx: GameContext, turnPlayer: string) => boolean,
): void {
      try {
        const turnPlayer = (ctx as any).state.turnPlayer;
        if (turnPlayer) {
          if (shouldPerformDrawStepTurnAction(ctx, String(turnPlayer))) {
            // Calculate total cards to draw: 1 (base) + any additional draws from effects
            const additionalDraws = (ctx as any).additionalDrawsPerTurn?.[turnPlayer] || 0;
            const totalDraws = 1 + additionalDraws;

            const drawn = drawCards(ctx, turnPlayer, totalDraws, { skipEventPersistence: true });
            debug(2,
              `${ts()} [nextStep] Drew ${drawn.length} card(s) for ${turnPlayer} at draw step (base: 1, additional: ${additionalDraws})`
            );
            // SBAs after the draw turn-based action (Rule 704.5b empty-library loss).
            try {
              runSBA(ctx);
            } catch (sbaErr) {
              debugWarn(1, `${ts()} [nextStep] SBA after draw failed:`, sbaErr);
            }
          } else {
            debug(2, `${ts()} [nextStep] Skipped draw step turn action for ${turnPlayer} (Rule 103.8a first-turn two-player)`);
          }
        } else {
          debugWarn(2, `${ts()} [nextStep] No turnPlayer set, cannot draw card`);
        }
      } catch (err) {
        debugWarn(1, `${ts()} [nextStep] Failed to draw card:`, err);
      }
}
