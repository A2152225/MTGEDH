import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { tryDeferTriggeredAbilityBeforeExecution } from './stackResolveTriggeredAbilityDeferralUtils.js';
import type { TriggeredAbilityStackResolveOptions } from './stackResolveSharedTypes.js';
import { resolveTriggerStackItemEffectText } from './triggerStackItemEffectText.js';

export { resolveTriggerStackItemEffectText } from './triggerStackItemEffectText.js';

/**
 * Resolves a triggered-ability stack item. Returns true when resolveTopOfStack
 * should return immediately (prompt queued, effect applied, or seq bumped).
 */
export function resolveTriggeredAbilityStackItem(
  ctx: GameContext,
  options: TriggeredAbilityStackResolveOptions,
): boolean {
  const item = options.item;
  const controller = options.controller;
  const executeTriggerEffect = options.executeTriggerEffect;
  const state = (ctx as any).state;
  const bumpSeq = typeof (ctx as any).bumpSeq === 'function'
    ? (ctx as any).bumpSeq.bind(ctx)
    : () => {};

  const sourceName = (item as any).sourceName || 'Unknown';
  const description = (item as any).description || '';
  const triggerController = (item as any).controller || controller;
  const triggerType = (item as any).triggerType;
  const sourceId = (item as any).id;
  const effectText = resolveTriggerStackItemEffectText(item, { state: (ctx as any).state });
  const optionalTriggeredAbilityDecisionApplied = (item as any).optionalTriggeredAbilityDecisionApplied === true;

  debug(2, `[resolveTopOfStack] Triggered ability from ${sourceName} resolved: ${description}`);

  if (tryDeferTriggeredAbilityBeforeExecution(ctx, item, {
    controller,
    triggerController: triggerController as PlayerID,
    sourceName,
    description,
    effectText,
    triggerType,
    sourceId,
    optionalTriggeredAbilityDecisionApplied,
    state,
    bumpSeq,
    executeTriggerEffect,
  })) {
    return true;
  }

  debug(2, `[resolveTopOfStack] Executing trigger effect: controller=${triggerController}, sourceName=${sourceName}, triggerType=${triggerType}`);
  executeTriggerEffect(ctx, triggerController, sourceName, effectText, item);
  bumpSeq();
  return true;
}
