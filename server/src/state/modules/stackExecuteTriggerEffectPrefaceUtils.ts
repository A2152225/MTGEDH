import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import {
  applyRetiredTriggerLegacyCastingModifierGrants,
  applyRetiredTriggerLegacyGraveyardPermissionEffects,
  applyRetiredTriggerLegacyPlaneswalkerLoyaltyCounters,
} from './oracleIrTriggerLegacyPrefaceHandlers.js';
import {
  applyRetiredTriggerLegacyDelayedCleanupTriggers,
} from './oracleIrTriggerLegacyDelayedCleanupHandlers.js';
import {
  applyRetiredTriggerLegacyExtraTurnAfterThisOne,
  applyRetiredTriggerLegacyGainControlOfTargetOpponent,
} from './oracleIrTriggerLegacyTurnAndZoneHandlers.js';

export function tryApplyTriggerEffectPrefaceHandlers(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any,
  state: any,
  battlefield: any[],
): boolean {
  if (applyRetiredTriggerLegacyPlaneswalkerLoyaltyCounters({
    ctx,
    controller,
    sourceName,
    description,
    triggerItem,
    state,
    battlefield,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyExtraTurnAfterThisOne({
    ctx,
    controller,
    sourceName,
    description,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyGainControlOfTargetOpponent({
    ctx,
    controller,
    sourceName,
    description,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyCastingModifierGrants({
    ctx,
    controller,
    sourceName,
    description,
    triggerItem,
    state,
    battlefield,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyGraveyardPermissionEffects({
    ctx,
    controller,
    sourceName,
    description,
    triggerItem,
    state,
    battlefield,
  })) {
    return true;
  }

  // Scheduled delayed effects (upkeep draw, end-step exile, etc.) must run before Oracle IR
  // so IR-primary mode cannot swallow stack items that carry delayedAction metadata.
  if (applyRetiredTriggerLegacyDelayedCleanupTriggers({
    ctx,
    controller,
    sourceName,
    triggerItem,
    state,
  })) {
    return true;
  }

  return false;
}
