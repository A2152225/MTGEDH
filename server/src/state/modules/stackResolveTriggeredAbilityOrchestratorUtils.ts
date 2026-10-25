import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { tryDeferTriggeredAbilityBeforeExecution } from './stackResolveTriggeredAbilityDeferralUtils.js';
import type { TriggeredAbilityStackResolveOptions } from './stackResolveSharedTypes.js';
import { resolveTriggerStackItemEffectText } from './triggerStackItemEffectText.js';
import { maybeSacrificeSagaAfterChapterResolve } from './triggerSagaLoreUtils.js';
import { resolveTriggeredAbilityControllerId } from './triggerSourceUtils.js';
import { scheduleParsedTriggerRiders } from './parsedTriggerRiderSchedule.js';
import { tryResolveCaseSolveTrigger } from './caseSolve.js';

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
  const resolvedController = resolveTriggeredAbilityControllerId(state, item, controller);
  if (resolvedController && String((item as any).controller || '').trim() !== resolvedController) {
    (item as any).controller = resolvedController;
  }
  const triggerController = resolvedController || (item as any).controller || controller;
  const triggerType = (item as any).triggerType;
  const sourceId = (item as any).id;
  const effectText = resolveTriggerStackItemEffectText(item, { state: (ctx as any).state });
  const optionalTriggeredAbilityDecisionApplied = (item as any).optionalTriggeredAbilityDecisionApplied === true;

  debug(2, `[resolveTopOfStack] Triggered ability from ${sourceName} resolved: ${description}`);

  if (!String(triggerController || '').trim()) {
    debugWarn(
      1,
      `[resolveTopOfStack] Skipping triggered ability from ${sourceName}: missing controller ` +
      `(source=${String((item as any).source || (item as any).sourceId || '')}, triggerType=${triggerType})`,
    );
    bumpSeq();
    return true;
  }

  if (tryResolveCaseSolveTrigger(ctx, item)) return true;

  if (tryDeferTriggeredAbilityBeforeExecution(ctx, item, {
    controller: triggerController as PlayerID,
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
  executeTriggerEffect(ctx, triggerController as PlayerID, sourceName, effectText, item);
  scheduleParsedTriggerRiders(ctx, item, String(triggerController || ''));
  maybeSacrificeSagaAfterChapterResolve(ctx, triggerController as PlayerID, item);
  bumpSeq();
  return true;
}
