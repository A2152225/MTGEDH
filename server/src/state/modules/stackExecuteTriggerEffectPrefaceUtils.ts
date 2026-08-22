import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import {
  applyPlaneswalkerLoyaltyCountersFromTriggerMetadata,
} from './triggerPlaneswalkerLoyaltyUtils.js';
import {
  applyDelayedCleanupTriggersFromMetadata,
} from './triggerDelayedCleanupUtils.js';
import {
  applyEmrakulGainControlOfTargetOpponentFromTrigger,
} from './triggerEmrakulGainControlUtils.js';
import {
  applyBoundGraveyardReturnFromTriggerMetadata,
} from './triggerBoundGraveyardReturnUtils.js';
import {
  queueUpkeepSacrificeCreatureOrSelfFromTrigger,
} from './triggerUpkeepSacrificeUtils.js';
import {
  applySagaLoreCounterFromTrigger,
} from './triggerSagaLoreUtils.js';
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
  if (applyPlaneswalkerLoyaltyCountersFromTriggerMetadata({
    ctx,
    sourceName,
    triggerItem,
    battlefield,
  })) {
    return legacyPrefaceHandled('applyPlaneswalkerLoyaltyCountersFromTriggerMetadata');
  }

  if (applyEmrakulGainControlOfTargetOpponentFromTrigger({
    ctx,
    controller,
    sourceName,
    description,
    triggerItem,
    state,
  })) {
    return legacyPrefaceHandled('applyEmrakulGainControlOfTargetOpponentFromTrigger');
  }

  // Scheduled delayed effects (upkeep draw, end-step exile, etc.) must run before Oracle IR
  // so IR-primary mode cannot swallow stack items that carry delayedAction metadata.
  if (applyDelayedCleanupTriggersFromMetadata({
    ctx,
    controller,
    sourceName,
    triggerItem,
    state,
  })) {
    return legacyPrefaceHandled('applyDelayedCleanupTriggersFromMetadata');
  }

  if (applyBoundGraveyardReturnFromTriggerMetadata({
    ctx,
    state,
    controller,
    sourceName,
    triggerItem,
  })) {
    return legacyPrefaceHandled('applyBoundGraveyardReturnFromTriggerMetadata');
  }

  if (queueUpkeepSacrificeCreatureOrSelfFromTrigger({
    ctx,
    controller,
    sourceName,
    description,
    triggerItem,
    state,
  })) {
    return legacyPrefaceHandled('queueUpkeepSacrificeCreatureOrSelfFromTrigger');
  }

  if (applySagaLoreCounterFromTrigger({
    ctx,
    controller,
    sourceName,
    triggerItem,
  })) {
    return legacyPrefaceHandled('applySagaLoreCounterFromTrigger');
  }

  return legacyPrefaceNotHandled();
}

