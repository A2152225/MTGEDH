import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { recalculatePlayerEffects } from './game-state-effects.js';
import { queueTributeChoiceOnEntry } from './triggerTributeChoiceUtils.js';
import { queuePermanentAsEntersBattlefieldChoiceSteps } from './stackResolvePermanentEtbChoiceUtils.js';
import { queuePermanentEntersBattlefieldTriggerStackItems } from './stackResolvePermanentEtbTriggerUtils.js';
import { applyPermanentSquadTokenCopiesOnEntry } from './stackResolvePermanentSquadUtils.js';
import { applyAsEntersAutomaticReplacementsForPermanent } from './oracleIrAsEntersAutomaticReplacements.js';
import type { PermanentSpellPostEntryOptions } from './stackResolveSharedTypes.js';
import { maybeQueueEvokeTriggerOrderStep } from './evokeTriggerOrdering.js';

export function applyPermanentSpellPostEntrySteps(
  ctx: GameContext,
  options: PermanentSpellPostEntryOptions,
): void {
  const { controller, card, newPermanent, newPermId, isCreature } = options;
  // Batch 13: a face-down (morph/disguise) permanent has no abilities, so its real card's
  // as-enters choices and ETB triggers must not fire.
  const effectiveCard = newPermanent?.isFaceDown === true && newPermanent?.card ? newPermanent.card : options.effectiveCard;

  queuePermanentAsEntersBattlefieldChoiceSteps(ctx, {
    controller,
    effectiveCard,
    newPermanent,
    newPermId,
    isCreature,
  });

  applyAsEntersAutomaticReplacementsForPermanent(ctx, newPermanent);

  const tributeChoiceDeferred = queueTributeChoiceOnEntry(ctx, newPermanent, controller);
  if (!tributeChoiceDeferred) {
    queuePermanentEntersBattlefieldTriggerStackItems(ctx, {
      controller,
      card,
      effectiveCard,
      newPermanent,
      newPermId,
      isCreature,
    });
  } else {
    debug(2, `[resolveTopOfStack] ${effectiveCard.name || 'Permanent'} tribute choice queued before ETB triggers are created`);
  }

  maybeQueueEvokeTriggerOrderStep(ctx, newPermanent, controller);

  applyPermanentSquadTokenCopiesOnEntry(ctx, {
    controller,
    card,
    effectiveCard,
    isCreature,
    basePower: newPermanent.basePower,
    baseToughness: newPermanent.baseToughness,
  });

  try {
    recalculatePlayerEffects(ctx);
  } catch (err) {
    debugWarn(1, '[resolveTopOfStack] Failed to recalculate player effects:', err);
  }
}
