import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import {
  parseChosenTypeCounterEachCreatureEffect,
  parseChosenTypeDrawPerCreatureEffect,
} from './chosen-creature-type.js';
import { isTriggerEffectOwnedByOracleIrPrimary } from './oracleIrTriggerLegacyRouting.js';
import { normalizeTriggerEffectDescriptionForExecution } from './trigger-runtime-wiring.js';
import { resolveChosenTypeCounterEachCreature } from './triggerChosenTypeCounterUtils.js';
import { resolveChosenTypeDrawPerCreature } from './triggerChosenTypeSpellUtils.js';

export function tryApplyPresetTriggerChosenTypeEffects(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  effectText: string,
  triggerItem: any,
): boolean {
  const normalizedDescription = normalizeTriggerEffectDescriptionForExecution(String(effectText || ''));
  const chosenType = String(
    triggerItem?.chosenCreatureType
    || triggerItem?.card?.chosenCreatureType
    || '',
  ).trim();
  if (!chosenType) return false;

  if (isTriggerEffectOwnedByOracleIrPrimary(normalizedDescription, sourceName)) {
    return false;
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
