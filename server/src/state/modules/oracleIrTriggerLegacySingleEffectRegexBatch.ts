import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import {
  applyRetiredTriggerLegacyCreatureControllerLosesLife,
  applyRetiredTriggerLegacyDealsDamageToEachOpponent,
  applyRetiredTriggerLegacyDoublePlusOneCountersOnSelf,
  applyRetiredTriggerLegacyEachOpponentLosesLife,
  applyRetiredTriggerLegacyEachOpponentDiscards,
  applyRetiredTriggerLegacyEachPlayerCounterPlacement,
  applyRetiredTriggerLegacyEachPlayerDraws,
  applyRetiredTriggerLegacyElspethCounterFromAmong,
  applyRetiredTriggerLegacyEnergyEffects,
  applyRetiredTriggerLegacyIndestructibleCounterOnSelf,
  applyRetiredTriggerLegacyLootStyleTopLibrary,
  applyRetiredTriggerLegacyMayGainLife,
  applyRetiredTriggerLegacyPlusOneCounterEachCreatureYouControl,
  applyRetiredTriggerLegacyPlusOneCounterEachOtherType,
  applyRetiredTriggerLegacyPlusOneCounterOnSelf,
  applyRetiredTriggerLegacyPowerBasedCountersEachCreatureYouControl,
  applyRetiredTriggerLegacyScry,
  applyRetiredTriggerLegacySingleDraw,
  applyRetiredTriggerLegacySingleGainLife,
  applyRetiredTriggerLegacyTargetPlayerDraws,
  applyRetiredTriggerLegacyTargetPlayerLoseYouGainLife,
  applyRetiredTriggerLegacyTokenCounters,
  applyRetiredTriggerLegacyTwoPlusOneCountersOnTarget,
  applyRetiredTriggerLegacyUntapTapLands,
} from './oracleIrTriggerLegacyRegexHandlers.js';
import {
  applyRetiredTriggerLegacyBelbePortalPutFromHand,
  applyRetiredTriggerLegacyKynaiosLandDrawChoice,
  applyRetiredTriggerLegacyPutCreatureFromHandOntoBattlefield,
} from './oracleIrTriggerLegacyResolutionHandlers.js';
import {
  applyRetiredTriggerLegacyGenericSearchLibrary,
  applyRetiredTriggerLegacyProteanHulkSearch,
} from './oracleIrTriggerLegacySearchHandlers.js';
import {
  applyRetiredTriggerLegacyCreateCreatureToken,
  applyRetiredTriggerLegacyEquippedCreatureCopyToken,
  applyRetiredTriggerLegacyPredefinedArtifactTokens,
  applyRetiredTriggerLegacyTargetPlayerCreatesToken,
} from './oracleIrTriggerLegacyTokenHandlers.js';
import {
  applyRetiredTriggerLegacyEachOpponentMills,
  applyRetiredTriggerLegacyTargetPlayerMills,
  applyRetiredTriggerLegacyThatPermanentControllerMills,
} from './oracleIrTriggerLegacyMillHandlers.js';
import {
  applyRetiredTriggerLegacySelfCantBeBlocked,
  applyRetiredTriggerLegacySelfCantBeBlockedByLowPower,
  applyRetiredTriggerLegacySelfPreventCombatDamage,
  applyRetiredTriggerLegacyTargetCreatureCantBeBlocked,
} from './oracleIrTriggerLegacyCombatEvasionHandlers.js';
import { applyRetiredTriggerLegacyChosenTypeCounterEachCreature } from './oracleIrTriggerLegacyCounterHandlers.js';

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

  if (applyRetiredTriggerLegacySingleGainLife({ desc, controller, state })) {
    return true;
  }

  if (applyRetiredTriggerLegacyMayGainLife({ desc, controller, state })) {
    return true;
  }

  if (applyRetiredTriggerLegacyEachOpponentLosesLife({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    triggerCard,
    state,
    opponents,
    battlefield,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyDealsDamageToEachOpponent({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
    opponents,
    battlefield,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyTargetPlayerLoseYouGainLife({
    desc,
    controller,
    triggerItem,
    opponents,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyCreatureControllerLosesLife({
    desc,
    controller,
    triggerItem,
    state,
  })) {
    return true;
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

  if (applyRetiredTriggerLegacyTwoPlusOneCountersOnTarget({ desc, triggerItem, state })) {
    return true;
  }

  if (applyRetiredTriggerLegacyChosenTypeCounterEachCreature({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyPowerBasedCountersEachCreatureYouControl({
    desc,
    controller,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyPlusOneCounterEachCreatureYouControl({ desc, controller, state })) {
    return true;
  }

  if (applyRetiredTriggerLegacyPlusOneCounterEachOtherType({
    desc,
    controller,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyPlusOneCounterOnSelf({ desc, triggerItem, state })) {
    return true;
  }

  if (applyRetiredTriggerLegacyIndestructibleCounterOnSelf({
    desc,
    sourceName,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyDoublePlusOneCountersOnSelf({ desc, triggerItem, state })) {
    return true;
  }

  if (applyRetiredTriggerLegacySingleDraw({ ctx, controller, desc, isKynaiosEffect })) {
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

  if (applyRetiredTriggerLegacyTargetPlayerDraws({ ctx, controller, desc, triggerItem })) {
    return true;
  }

  if (applyRetiredTriggerLegacyUntapTapLands({
    sourceName,
    desc,
    controller,
    triggerItem,
    state,
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

  if (applyRetiredTriggerLegacyGenericSearchLibrary({
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

  if (applyRetiredTriggerLegacyTargetPlayerCreatesToken({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyPredefinedArtifactTokens({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyCreateCreatureToken({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyEquippedCreatureCopyToken({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyEachOpponentMills({
    ctx,
    controller,
    desc,
    opponents,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyThatPermanentControllerMills({
    ctx,
    controller,
    sourceName,
    desc,
    opponents,
    state,
    triggerItem,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyTargetPlayerMills({
    ctx,
    controller,
    sourceName,
    desc,
    opponents,
    state,
    triggerItem,
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

  if (applyRetiredTriggerLegacyScry({ desc, controller, state })) {
    return true;
  }

  if (applyRetiredTriggerLegacyEachPlayerDraws({ ctx, sourceName, desc, players })) {
    return true;
  }

  if (applyRetiredTriggerLegacyEachOpponentDiscards({ desc, state, opponents })) {
    return true;
  }

  return false;
}
