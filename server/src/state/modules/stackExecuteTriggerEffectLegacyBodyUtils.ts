import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import {
  applyRetiredTriggerLegacyRevealUntilEquipment,
  applyRetiredTriggerLegacyGenericSearchLibrary,
} from './oracleIrTriggerLegacySearchHandlers.js';
import {
  applyRetiredTriggerLegacyJoinForcesAttack,
} from './oracleIrTriggerLegacyResolutionHandlers.js';
import {
  applyRetiredTriggerLegacyHandSizeLifeGain,
} from './oracleIrTriggerLegacyLifeAndGameHandlers.js';
import {
  applyRetiredTriggerLegacyGameStateOracleHooks,
} from './oracleIrTriggerLegacyGameStateHooks.js';
import {
  applyRetiredTriggerLegacyAttachToTargetCreatureYouControl,
  applyRetiredTriggerLegacySelfExileCreateToken,
} from './oracleIrTriggerLegacySelfReflexiveHandlers.js';
import {
  applyRetiredTriggerLegacyExileTargetPlayerGraveyard,
  applyRetiredTriggerLegacyExileTopTwoPlayableChoice,
} from './oracleIrTriggerLegacyTurnAndZoneHandlers.js';
import {
  applyRetiredTriggerLegacyAgentOfShadowThievesAttack,
  applyRetiredTriggerLegacyEachMerfolkExplores,
  applyRetiredTriggerLegacyElixirOfImmortality,
} from './oracleIrTriggerLegacyCardSpecificHandlers.js';
import {
  applyRetiredTriggerLegacyUpkeepSacrificeCreatureOrSelf,
} from './oracleIrTriggerLegacySacrificeHandlers.js';
import {
  applyRetiredTriggerLegacyAttackingPlayerGainsControlOfArtifact,
  applyRetiredTriggerLegacyParadigmTrigger,
  applyRetiredTriggerLegacyReboundTrigger,
  applyRetiredTriggerLegacySacrificeThisCreature,
} from './oracleIrTriggerLegacySpecialTriggerHandlers.js';
import {
  applyRetiredTriggerLegacyDelayedDrawAtNextUpkeep,
  applyRetiredTriggerLegacyUntapAllCreatureType,
} from './oracleIrTriggerLegacyTimingHandlers.js';
import {
  applyRetiredTriggerLegacyAttackCountBasedCreateCreatureToken,
  applyRetiredTriggerLegacyAttackTriggerCreateCreatureToken,
  applyRetiredTriggerLegacyBlockTriggerCreateCreatureToken,
} from './oracleIrTriggerLegacyTokenHandlers.js';
import {
  applyRetiredTriggerLegacyOptionalDiscardThenDraw,
  applyRetiredTriggerLegacySacrificeAnotherPermanentForBenefit,
  applyRetiredTriggerLegacyThatPlayerSacrificesAndLosesLife,
} from './oracleIrTriggerLegacyCombinedHandlers.js';
import {
  applyRetiredTriggerLegacyInterveningSubjectKeywordGrant,
  computeTriggerLegacyIsKynaiosEffect,
  computeTriggerLegacySourceNames,
  stripTriggerLegacyInterveningIfPrefix,
} from './oracleIrTriggerLegacyDescPrepHandlers.js';
import {
  applyRetiredTriggerLegacyCombatDamageDrawEffects,
} from './oracleIrTriggerLegacyCombatDamageHandlers.js';
import {
  applyRetiredTriggerLegacyBoundGraveyardReturnEffect,
  applyRetiredTriggerLegacyDiscardTriggeredCastFromGraveyard,
  applyRetiredTriggerLegacyTargetedPlayFromGraveyard,
} from './oracleIrTriggerLegacyGraveyardHandlers.js';
import {
  applyRetiredTriggerLegacyChosenTypeTopCardReveal,
  applyRetiredTriggerLegacyRevealTopCreatureOfChosenType,
} from './oracleIrTriggerLegacyLibraryHandlers.js';

export type { TriggerEffectLegacyBodyContinuation, TriggerEffectLegacyBodyResult } from './stackResolveSharedTypes.js';
import type { TriggerEffectLegacyBodyContinuation, TriggerEffectLegacyBodyResult } from './stackResolveSharedTypes.js';

function buildTriggerEffectLegacyBodyContinuation(
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any,
  state: any,
): TriggerEffectLegacyBodyContinuation {
  let desc = String(description || '').replace(/[â€™]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
  let descriptionForOracleFallback = String(description || '');
  const {
    sourceNameLower,
    triggerSourceNameLower,
  } = computeTriggerLegacySourceNames(sourceName, triggerItem);
  const isKynaiosEffect = computeTriggerLegacyIsKynaiosEffect(sourceName, triggerItem, desc);
  desc = stripTriggerLegacyInterveningIfPrefix(desc);
  const players = state.players || [];
  const opponents = players.filter((p: any) => p.id !== controller && !p.hasLost);
  const battlefield = state.battlefield || [];
  return {
    desc,
    descriptionForOracleFallback,
    isKynaiosEffect,
    sourceNameLower,
    triggerSourceNameLower,
    opponents,
    players,
    battlefield,
  };
}

export function tryApplyTriggerEffectLegacyBodyHandlers(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any,
  state: any,
  triggerCard: any,
): TriggerEffectLegacyBodyResult {
  if (applyRetiredTriggerLegacyDiscardTriggeredCastFromGraveyard({
    ctx,
    controller,
    sourceName,
    description,
    triggerItem,
    state,
    triggerCard,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyTargetedPlayFromGraveyard({
    ctx,
    controller,
    sourceName,
    description,
    triggerItem,
    state,
    triggerCard,
  })) {
    return { handled: true };
  }

  let desc = String(description || '').replace(/[â€™]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
  let descriptionForOracleFallback = String(description || '');
  if (applyRetiredTriggerLegacyExileTargetPlayerGraveyard({ desc, triggerItem, state })) {
    return { handled: true };
  }
  if (applyRetiredTriggerLegacyExileTopTwoPlayableChoice({
    ctx,
    controller,
    sourceName,
    description,
    desc,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  const {
    sourceNameLower,
    triggerSourceNameLower,
    triggerSourceId,
  } = computeTriggerLegacySourceNames(sourceName, triggerItem);
  const isKynaiosEffect = computeTriggerLegacyIsKynaiosEffect(sourceName, triggerItem, desc);

  desc = stripTriggerLegacyInterveningIfPrefix(desc);

  if (applyRetiredTriggerLegacyInterveningSubjectKeywordGrant({
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  const resolvedBoundGraveyardReturn = applyRetiredTriggerLegacyBoundGraveyardReturnEffect({
    ctx,
    state,
    controller,
    sourceName,
    triggerItem,
  });
  if (resolvedBoundGraveyardReturn) {
    return { handled: true };
  }

  const sourcePermanentIdForSelf = String(
    (triggerItem as any)?.source ||
    (triggerItem as any)?.permanentId ||
    (triggerItem as any)?.sourceId ||
    ''
  ).trim();

  if (applyRetiredTriggerLegacySelfExileCreateToken({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
    sourcePermanentIdForSelf,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyAttachToTargetCreatureYouControl({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
    sourcePermanentIdForSelf,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyGameStateOracleHooks({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
    triggerSourceId,
  })) {
    return { handled: true };
  }

  const players = state.players || [];
  const opponents = players.filter((p: any) => p.id !== controller && !p.hasLost);
  const battlefield = state.battlefield || [];

  if (applyRetiredTriggerLegacyEachMerfolkExplores({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyThatPlayerSacrificesAndLosesLife({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
    triggerCard,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyHandSizeLifeGain({
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
    sourceNameLower,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyChosenTypeTopCardReveal({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyRevealTopCreatureOfChosenType({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyCombatDamageDrawEffects({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
    sourceNameLower,
    triggerSourceNameLower,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacySacrificeThisCreature({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyAttackingPlayerGainsControlOfArtifact({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyReboundTrigger({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyParadigmTrigger({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyElixirOfImmortality({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyUpkeepSacrificeCreatureOrSelf({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  const triggerType = (triggerItem as any).triggerType;
  debug(2, `[executeTriggerEffect] triggerType=${triggerType}, sourceName=${sourceName}`);
  if (applyRetiredTriggerLegacyAttackTriggerCreateCreatureToken({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyAttackCountBasedCreateCreatureToken({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyBlockTriggerCreateCreatureToken({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyAgentOfShadowThievesAttack({
    controller,
    desc,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyJoinForcesAttack({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
    players,
    battlefield,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyOptionalDiscardThenDraw({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacySacrificeAnotherPermanentForBenefit({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyGenericSearchLibrary({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  if (applyRetiredTriggerLegacyRevealUntilEquipment({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  const delayedDrawResult = applyRetiredTriggerLegacyDelayedDrawAtNextUpkeep({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    descriptionForOracleFallback,
    triggerItem,
    state,
  });
  if (delayedDrawResult.matched) {
    if (delayedDrawResult.stopProcessing) {
      return { handled: true };
    }
    if (delayedDrawResult.updatedDesc !== undefined) {
      desc = delayedDrawResult.updatedDesc;
    }
    if (delayedDrawResult.updatedDescriptionForOracleFallback !== undefined) {
      descriptionForOracleFallback = delayedDrawResult.updatedDescriptionForOracleFallback;
    }
  }

  if (applyRetiredTriggerLegacyUntapAllCreatureType({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    descriptionForOracleFallback,
    triggerItem,
    state,
  })) {
    return { handled: true };
  }

  return {
    handled: false,
    ...buildTriggerEffectLegacyBodyContinuation(controller, sourceName, description, triggerItem, state),
  };
}
