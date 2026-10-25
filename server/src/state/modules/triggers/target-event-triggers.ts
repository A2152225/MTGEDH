/**
 * Target events for one stack object: commits_crime and becomes_target.
 * Called from queueStackPutTriggers (cast, activation, triggered ability, IR copy) and
 * queueSpellCopiedTriggers (every copy site). Both families are idempotent per object.
 * Public: queueTargetEventTriggersForStackItem.
 */
import { queueCrimeTriggersForStackItem } from './crime-triggers.js';
import {
  extractStackItemTargetIds,
  persistTargetedTriggeredStackItems,
  triggerPermanentTargetedTriggersFromAbility,
  triggerPermanentTargetedTriggersFromSpell,
} from './targeted.js';

export function queueTargetEventTriggersForStackItem(
  ctx: any,
  stackItemId: string,
  options?: { gameId?: string; skipCrime?: boolean },
): any[] {
  if (!ctx || ctx.isReplaying) return [];
  const itemId = String(stackItemId || '').trim();
  const stack = Array.isArray(ctx.state?.stack) ? ctx.state.stack : [];
  const item = stack.find((entry: any) => String(entry?.id || '') === itemId);
  if (!item) return [];
  const gameId = String(options?.gameId || ctx.gameId || ctx.id || '').trim();
  const out: any[] = options?.skipCrime ? [] : queueCrimeTriggersForStackItem(ctx, itemId, undefined, gameId);
  const targetIds = extractStackItemTargetIds(item);
  const controller = String(item.controller || '').trim();
  if (targetIds.length === 0 || !controller) return out;
  const created = String(item.type || 'spell').toLowerCase() === 'spell'
    ? triggerPermanentTargetedTriggersFromSpell(ctx, { castBy: controller as any, stackItemId: itemId, targetIds })
    : triggerPermanentTargetedTriggersFromAbility(ctx, {
      activatedBy: controller as any,
      sourcePermanentId: String(item.source || item.permanentId || item.sourceId || ''),
      stackItemId: itemId,
      targetIds,
    });
  persistTargetedTriggeredStackItems(gameId, ctx, created);
  return [...out, ...created];
}
