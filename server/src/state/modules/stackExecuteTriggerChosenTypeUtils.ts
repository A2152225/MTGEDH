import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import {
  parseChosenTypeCounterEachCreatureEffect,
  parseChosenTypeDrawPerCreatureEffect,
  parseChosenTypeTopCardRevealToHand,
} from './chosen-creature-type.js';
import { isTriggerEffectOwnedByOracleIrPrimary } from './oracleIrTriggerLegacyRouting.js';
import { normalizeTriggerEffectDescriptionForExecution } from './trigger-runtime-wiring.js';
import { tryResolveCopyThatCreatureHasteExile } from './triggerChosenTypeCopyTokenUtils.js';
import { resolveChosenTypeCounterEachCreature } from './triggerChosenTypeCounterUtils.js';
import {
  resolveChosenTypeDrawPerCreature,
  resolveChosenTypeTopCardRevealToHand,
} from './triggerChosenTypeSpellUtils.js';

export function tryApplyPresetTriggerChosenTypeEffects(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  effectText: string,
  triggerItem: any,
): boolean {
  const normalizedDescription = normalizeTriggerEffectDescriptionForExecution(String(effectText || ''));
  const sourcePermanentId = String(triggerItem?.source || triggerItem?.permanentId || '').trim();
  const sourcePermanent = sourcePermanentId
    ? ((ctx as any).state?.battlefield || []).find((perm: any) => String(perm?.id || '') === sourcePermanentId)
    : undefined;
  const chosenType = String(
    triggerItem?.chosenCreatureType
    || triggerItem?.card?.chosenCreatureType
    || sourcePermanent?.chosenCreatureType
    || '',
  ).trim();

  if (isTriggerEffectOwnedByOracleIrPrimary(normalizedDescription, sourceName)) {
    return false;
  }

  if (tryResolveCopyThatCreatureHasteExile(ctx, controller, sourceName, normalizedDescription, triggerItem)) {
    return true;
  }

  if (!chosenType) return false;

  if (parseChosenTypeTopCardRevealToHand(normalizedDescription)) {
    return resolveChosenTypeTopCardRevealToHand(
      ctx,
      controller,
      chosenType,
      normalizedDescription,
      sourceName,
    );
  }

  if (parseChosenTypeCounterEachCreatureEffect(normalizedDescription)) {
    resolveChosenTypeCounterEachCreature(ctx, controller, chosenType, sourceName);
    return true;
  }

  if (parseChosenTypeDrawPerCreatureEffect(normalizedDescription)) {
    resolveChosenTypeDrawPerCreature(ctx, controller, chosenType, sourceName);
    return true;
  }

  return false;
}
