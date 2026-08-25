/**
 * Extracted from triggerReflexiveWhenYouDoQueueUtils.ts:
 * maybeQueueReflexiveAnyAmountManaPayment.
 * Cluster moved: maybeQueueReflexiveAnyAmountManaPayment.
 * No exclusive parent helpers (OUT->IN empty).
 * Parent keeps public exports and imports this leaf for internal dispatch.
 *
 * Leaf must not import triggerReflexiveWhenYouDoQueueUtils.ts or
 * triggerReflexiveWhenYouDoQueueUtils-handlers/index.ts.
 */

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { GameContext } from '../../context.js';
import { debug } from '../../../utils/debug.js';
import { ResolutionStepType } from '../../resolution/index.js';
import { queueResolveTopOfStackPrompt } from '../resolutionPromptEvents.js';
import {
  buildTriggerSourcePermanentSnapshot,
  getTriggerSourcePermanent,
} from '../triggerSourceUtils.js';
import {
  buildReflexivePaymentAmountOptions,
  getAvailableReflexiveManaAmountFromPool,
  parseReflexiveAnyAmountManaPayment,
} from '../reflexive-triggers.js';

export function maybeQueueReflexiveAnyAmountManaPayment(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  description: string,
): boolean {
  const parsed = parseReflexiveAnyAmountManaPayment(description);
  if (!parsed) return false;

  if ((ctx as any).isReplaying) {
    debug(2, `[resolveTopOfStack] Reflexive any-amount payment for ${sourceName}: skipping prompt discovery during replay`);
    return true;
  }

  const maxAmount = getAvailableReflexiveManaAmountFromPool((ctx as any).state, String(triggerController), parsed.paymentUnit);
  if (maxAmount <= 0) {
    debug(2, `[resolveTopOfStack] Reflexive any-amount payment for ${sourceName}: no payable mana available`);
    return true;
  }

  const sourcePermanentId = String((item as any).source || (item as any).permanentId || '').trim();
  const promptSourceId = sourcePermanentId || String(sourceId || '').trim();
  const triggerStackItemId = String((item as any).id || sourceId || '').trim();
  const sourcePermanentSnapshot = buildTriggerSourcePermanentSnapshot(getTriggerSourcePermanent((ctx as any).state, item));
  const paymentUnitLabel = parsed.paymentUnit === 'mana' ? 'mana' : parsed.paymentUnit;

  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: triggerController as PlayerID,
    sourceId: promptSourceId || undefined,
    sourceName,
    sourceImage: (item as any)?.card?.image_uris?.small || (item as any)?.card?.image_uris?.normal,
    description: `${sourceName}: You may pay any amount of ${paymentUnitLabel}.`,
    mandatory: false,
    options: buildReflexivePaymentAmountOptions(maxAmount, parsed.paymentUnit),
    minSelections: 1,
    maxSelections: 1,
    reflexiveManaPaymentChoice: true,
    reflexiveManaPaymentUnit: parsed.paymentUnit,
    reflexiveManaPaymentMaxAmount: maxAmount,
    reflexiveManaPaymentFollowupText: parsed.followupText,
    reflexiveManaPaymentOriginalEffect: description,
    reflexiveManaPaymentController: String(triggerController),
    reflexiveManaPaymentSourceName: sourceName,
    reflexiveManaPaymentSourcePermanentId: sourcePermanentId || undefined,
    reflexiveManaPaymentTriggerStackItemId: triggerStackItemId || undefined,
    ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
  } as any);

  debug(2, `[resolveTopOfStack] Deferred reflexive any-amount payment trigger for ${sourceName} (${triggerController})`);
  return true;
}

