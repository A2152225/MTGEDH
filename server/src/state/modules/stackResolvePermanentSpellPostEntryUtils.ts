import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { recalculatePlayerEffects } from './game-state-effects.js';
import { queueTributeChoiceOnEntry } from './triggerTributeChoiceUtils.js';
import { queuePermanentAsEntersBattlefieldChoiceSteps } from './stackResolvePermanentEtbChoiceUtils.js';
import { queuePermanentEntersBattlefieldTriggerStackItems } from './stackResolvePermanentEtbTriggerUtils.js';
import { applyPermanentSquadTokenCopiesOnEntry } from './stackResolvePermanentSquadUtils.js';
import type { PermanentSpellPostEntryOptions } from './stackResolveSharedTypes.js';

export function applyPermanentSpellPostEntrySteps(
  ctx: GameContext,
  options: PermanentSpellPostEntryOptions,
): void {
  const { controller, card, effectiveCard, newPermanent, newPermId, isCreature } = options;

  queuePermanentAsEntersBattlefieldChoiceSteps(ctx, {
    controller,
    effectiveCard,
    newPermanent,
    newPermId,
    isCreature,
  });

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
