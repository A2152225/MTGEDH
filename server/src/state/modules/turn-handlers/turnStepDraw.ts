// server/src/state/modules/turn-handlers/turnStepDraw.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: the draw-step body from nextStep() when entering DRAW —
// "at the beginning of your draw step" triggers (Rule 504.1).
// Public entry symbols: runTurnStepDraw.
// Called from nextStep() in the parent; not part of the public turn.ts API.
// Shared nextStep closures (pushTriggersToStack) are passed in so this leaf
// does not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { getDrawStepTriggers } from "../triggered-abilities.js";

/**
 * Draw-step beginning triggers from nextStep() when entering DRAW (Rule 504.1).
 * nextStep remains the dispatcher and supplies pushTriggersToStack.
 */
export function runTurnStepDraw(
  ctx: GameContext,
  turnPlayer: string,
  pushTriggersToStack: (triggers: any[], triggerType: string, idPrefix: string) => void,
): void {
          const drawTriggers = getDrawStepTriggers(ctx, turnPlayer);
          pushTriggersToStack(drawTriggers, 'draw_step', 'draw');
}
