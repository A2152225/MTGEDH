/**
 * socket/resolution-handlers/triggerOrderResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse switch).
 * Cluster moved: handleTriggerOrderResponse (reorder simultaneous triggered abilities
 * on the stack in-place, preserving APNAP, then persist triggerOrderResponse).
 * Public entry symbols: handleTriggerOrderResponse.
 *
 * Terminal for the case: the original `break` becomes `return`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { applyTriggerOrderToStack } from "../../state/resolution/handlers/triggerOrder.js";
import { debug, debugWarn } from "../../utils/debug.js";

/**
 * Handle trigger ordering response
 */
export function handleTriggerOrderResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const orderedTriggerIds = response.selections as string[];
  
  if (!Array.isArray(orderedTriggerIds)) {
    debugWarn(1, `[Resolution] Invalid trigger order: not an array`);
    return;
  }
  
  // Get trigger step data for validation
  const triggerStep = step as any;
  const triggers = triggerStep.triggers || [];
  const requireAll = triggerStep.requireAll !== false; // default true
  
  // Validate all trigger IDs are in the triggers list
  const validTriggerIds = new Set(triggers.map((t: any) => t.id));
  for (const triggerId of orderedTriggerIds) {
    if (!validTriggerIds.has(triggerId)) {
      debugWarn(1, `[Resolution] Invalid trigger ID in order: ${triggerId} not in valid triggers`);
      return;
    }
  }
  
  // If requireAll is true, ensure all triggers are included
  if (requireAll && orderedTriggerIds.length !== triggers.length) {
    debugWarn(1, `[Resolution] Invalid trigger order: expected all ${triggers.length} triggers, got ${orderedTriggerIds.length}`);
    return;
  }
  
  // Actually reorder the triggers on the stack.
  // IMPORTANT: In this codebase, the top of stack is the END of the array (stack.pop()).
  // The client provides the desired RESOLUTION order (first in list resolves first).
  // Therefore, the first chosen trigger must be placed LAST among that player's triggers.
  //
  // CRITICAL: Preserve APNAP ordering across players.
  // Triggers from other players may already be above these in the stack. We must not
  // remove-and-push (which would move them to the very top). Instead, reorder in-place
  // within the stack slots currently occupied by the chosen triggers.
  const count = applyTriggerOrderToStack(game.state, orderedTriggerIds);

  if (count === 0) {
    debugWarn(2, `[Resolution] No trigger items found on stack to reorder`);
    debug(1, `[Resolution] Trigger order: ${orderedTriggerIds?.join(', ')}`);
    return;
  }

  debug(1, `[Resolution] Reordered ${count} triggers on stack (in-place)`);
  
  debug(1, `[Resolution] Trigger order: ${orderedTriggerIds?.join(', ')}`);

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'triggerOrderResponse', {
      stepId: String((step as any).id || ''),
      resolvedStepId: String((step as any).id || ''),
      playerId: pid,
      orderedTriggerIds: orderedTriggerIds.map((id: any) => String(id || '')).filter(Boolean),
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(triggerOrderResponse) failed:', err);
  }
  
  // Clear legacy pending state if present
  if (game.state.pendingTriggerOrdering?.[pid]) {
    delete game.state.pendingTriggerOrdering[pid];
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}
