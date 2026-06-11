import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import {
  applyRetiredTriggerLegacyEachPlayerCounterPlacement,
  applyRetiredTriggerLegacyElspethCounterFromAmong,
  applyRetiredTriggerLegacyEnergyEffects,
  applyRetiredTriggerLegacyLootStyleTopLibrary,
  applyRetiredTriggerLegacyTokenCounters,
  applyRetiredTriggerLegacyTwoPlusOneCountersOnTarget,
} from './oracleIrTriggerLegacyRegexHandlers.js';
import {
  applyRetiredTriggerLegacyBelbePortalPutFromHand,
  applyRetiredTriggerLegacyKynaiosLandDrawChoice,
  applyRetiredTriggerLegacyPutCreatureFromHandOntoBattlefield,
} from './oracleIrTriggerLegacyResolutionHandlers.js';
import {
  applyRetiredTriggerLegacyProteanHulkSearch,
} from './oracleIrTriggerLegacySearchHandlers.js';
import {
  applyRetiredTriggerLegacySelfCantBeBlocked,
  applyRetiredTriggerLegacySelfCantBeBlockedByLowPower,
  applyRetiredTriggerLegacySelfPreventCombatDamage,
  applyRetiredTriggerLegacyTargetCreatureCantBeBlocked,
} from './oracleIrTriggerLegacyCombatEvasionHandlers.js';
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
): boolean {
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
    return true;
  }

  if (applyRetiredTriggerLegacyTokenCounters({
    desc,
    controller,
    sourceName,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyElspethCounterFromAmong({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyTwoPlusOneCountersOnTarget({ desc, triggerItem, state, sourceName })) {
    return true;
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
    return true;
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
    return true;
  }

  if (applyRetiredTriggerLegacyLootStyleTopLibrary({
    ctx,
    controller,
    sourceName,
    desc,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyProteanHulkSearch({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
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
    return true;
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
    return true;
  }

  if (applyRetiredTriggerLegacyTargetCreatureCantBeBlocked({
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacySelfCantBeBlocked({
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacySelfPreventCombatDamage({
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacySelfCantBeBlockedByLowPower({
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  return false;
}
