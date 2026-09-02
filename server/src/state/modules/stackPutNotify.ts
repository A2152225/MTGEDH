/**
 * Origin: Grip of Chaos family stack-put.
 * Cluster: notify whenever a spell or ability is put onto the stack so
 *   "if it has a single target, reselect its target at random" can fire.
 * Public: notifySpellOrAbilityPutOnStack.
 */
import type { GameContext } from './context.js';
import { queueStackPutTriggers } from './triggers/stack-put.js';

export function notifySpellOrAbilityPutOnStack(ctx: GameContext, stackItemId: string): void {
  const id = String(stackItemId || '').trim();
  if (!id) return;
  try {
    queueStackPutTriggers(ctx, id);
  } catch {
    // Defensive: stack item is already on the stack.
  }
}
