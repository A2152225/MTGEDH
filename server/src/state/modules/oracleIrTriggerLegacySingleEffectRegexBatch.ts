import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import {
  applyRetiredTriggerLegacyEachPlayerCounterPlacement,
  applyRetiredTriggerLegacyElspethCounterFromAmong,
  applyRetiredTriggerLegacyEnergyEffects,
  applyRetiredTriggerLegacyLootStyleTopLibrary,
  applyRetiredTriggerLegacyTokenCounters,
} from './oracleIrTriggerLegacyRegexHandlers.js';
import {
  applyRetiredTriggerLegacyBelbePortalPutFromHand,
  applyRetiredTriggerLegacyKynaiosLandDrawChoice,
  applyRetiredTriggerLegacyPutCreatureFromHandOntoBattlefield,
} from './oracleIrTriggerLegacyResolutionHandlers.js';
import {
  applyRetiredTriggerLegacyProteanHulkSearch,
} from './oracleIrTriggerLegacySearchHandlers.js';
import { retiredLegacyHandlerHit, type RetiredTriggerLegacyHandlerHit } from './oracleIrTriggerLegacyHandlerTelemetry.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacySingleEffectBatchParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly description: string;
  readonly triggerItem: any;
  readonly triggerCard: any;
  readonly state: any;
  readonly opponents: readonly any[];
  readonly players: readonly any[];
  readonly battlefield: readonly any[];
  readonly isKynaiosEffect: boolean;
}

export function applyRetiredTriggerLegacySingleEffectRegexBatch(
  params: TriggerLegacySingleEffectBatchParams,
): RetiredTriggerLegacyHandlerHit {
  const {
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    triggerCard,
    state,
    opponents,
    players,
    battlefield,
    isKynaiosEffect,
  } = params;

  if (skipRetiredTriggerLegacyHandler(desc, sourceName)) {
    return false;
  }

  if (applyRetiredTriggerLegacyEnergyEffects({
    desc,
    controller,
    sourceName,
    state,
  })) {
    return retiredLegacyHandlerHit('applyRetiredTriggerLegacyEnergyEffects');
  }

  if (applyRetiredTriggerLegacyTokenCounters({
    desc,
    controller,
    sourceName,
    state,
  })) {
    return retiredLegacyHandlerHit('applyRetiredTriggerLegacyTokenCounters');
  }

  if (applyRetiredTriggerLegacyElspethCounterFromAmong({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return retiredLegacyHandlerHit('applyRetiredTriggerLegacyElspethCounterFromAmong');
  }

  if (applyRetiredTriggerLegacyKynaiosLandDrawChoice({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
    players,
    battlefield,
    isKynaiosEffect,
  })) {
    return retiredLegacyHandlerHit('applyRetiredTriggerLegacyKynaiosLandDrawChoice');
  }

  if (applyRetiredTriggerLegacyEachPlayerCounterPlacement({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
    players,
  })) {
    return retiredLegacyHandlerHit('applyRetiredTriggerLegacyEachPlayerCounterPlacement');
  }

  if (applyRetiredTriggerLegacyLootStyleTopLibrary({
    ctx,
    controller,
    sourceName,
    desc,
    state,
  })) {
    return retiredLegacyHandlerHit('applyRetiredTriggerLegacyLootStyleTopLibrary');
  }

  if (applyRetiredTriggerLegacyProteanHulkSearch({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return retiredLegacyHandlerHit('applyRetiredTriggerLegacyProteanHulkSearch');
  }

  if (applyRetiredTriggerLegacyBelbePortalPutFromHand({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
    players,
    battlefield,
  })) {
    return retiredLegacyHandlerHit('applyRetiredTriggerLegacyBelbePortalPutFromHand');
  }

  if (applyRetiredTriggerLegacyPutCreatureFromHandOntoBattlefield({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
    players,
    battlefield,
  })) {
    return retiredLegacyHandlerHit('applyRetiredTriggerLegacyPutCreatureFromHandOntoBattlefield');
  }

  return false;
}
