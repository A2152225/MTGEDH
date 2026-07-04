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
  applyRetiredTriggerLegacyGainControlOfTargetOpponent,
} from './oracleIrTriggerLegacyTurnAndZoneHandlers.js';
import {
  legacyPrefaceHandled,
  legacyPrefaceNotHandled,
  type TriggerPrefaceResult,
} from './oracleIrTriggerLegacyHandlerTelemetry.js';

export type { TriggerPrefaceResult };

export function tryApplyTriggerEffectPrefaceHandlers(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any,
  state: any,
  battlefield: any[],
): TriggerPrefaceResult {
  if (applyRetiredTriggerLegacyPlaneswalkerLoyaltyCounters({
    ctx,
    controller,
    sourceName,
    description,
    triggerItem,
    state,
    battlefield,
  })) {
    return legacyPrefaceHandled('applyRetiredTriggerLegacyPlaneswalkerLoyaltyCounters');
  }

  if (applyRetiredTriggerLegacyGainControlOfTargetOpponent({
    ctx,
    controller,
    sourceName,
    description,
    triggerItem,
    state,
  })) {
    return legacyPrefaceHandled('applyRetiredTriggerLegacyGainControlOfTargetOpponent');
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
    return legacyPrefaceHandled('applyRetiredTriggerLegacyCastingModifierGrants');
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
    return legacyPrefaceHandled('applyRetiredTriggerLegacyGraveyardPermissionEffects');
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
    return legacyPrefaceHandled('applyRetiredTriggerLegacyDelayedCleanupTriggers');
  }

  return legacyPrefaceNotHandled();
}
