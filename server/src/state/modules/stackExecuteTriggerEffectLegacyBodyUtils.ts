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
  applyRetiredTriggerLegacyGameStateOracleHooks,
} from './oracleIrTriggerLegacyGameStateHooks.js';
import {
  applyRetiredTriggerLegacyAttachToTargetCreatureYouControl,
  applyRetiredTriggerLegacySelfExileCreateToken,
} from './oracleIrTriggerLegacySelfReflexiveHandlers.js';
import {
  applyRetiredTriggerLegacyUpkeepSacrificeCreatureOrSelf,
} from './oracleIrTriggerLegacySacrificeHandlers.js';
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
  applyRetiredTriggerLegacyBoundGraveyardReturnEffect,
  applyRetiredTriggerLegacyDiscardTriggeredCastFromGraveyard,
  applyRetiredTriggerLegacyTargetedPlayFromGraveyard,
} from './oracleIrTriggerLegacyGraveyardHandlers.js';
import {
  applyRetiredTriggerLegacyChosenTypeTopCardReveal,
  applyRetiredTriggerLegacyRevealTopCreatureOfChosenType,
} from './oracleIrTriggerLegacyLibraryHandlers.js';
import { legacyBodyHandled } from './oracleIrTriggerLegacyHandlerTelemetry.js';
import { shouldSkipLegacyTriggerBodyHandlers } from './oracleIrTriggerLegacyRouting.js';

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
  if (shouldSkipLegacyTriggerBodyHandlers(description, sourceName)) {
    return {
      handled: false,
      ...buildTriggerEffectLegacyBodyContinuation(controller, sourceName, description, triggerItem, state),
    };
  }

  if (applyRetiredTriggerLegacyDiscardTriggeredCastFromGraveyard({
    ctx,
    controller,
    sourceName,
    description,
    triggerItem,
    state,
    triggerCard,
  })) {
    return legacyBodyHandled('applyRetiredTriggerLegacyDiscardTriggeredCastFromGraveyard');
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
    return legacyBodyHandled('applyRetiredTriggerLegacyTargetedPlayFromGraveyard');
  }

  let desc = String(description || '').replace(/[â€™]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
  let descriptionForOracleFallback = String(description || '');

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
    return legacyBodyHandled('applyRetiredTriggerLegacyInterveningSubjectKeywordGrant');
  }

  const resolvedBoundGraveyardReturn = applyRetiredTriggerLegacyBoundGraveyardReturnEffect({
    ctx,
    state,
    controller,
    sourceName,
    triggerItem,
  });
  if (resolvedBoundGraveyardReturn) {
    return legacyBodyHandled('applyRetiredTriggerLegacyBoundGraveyardReturnEffect');
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
    return legacyBodyHandled('applyRetiredTriggerLegacySelfExileCreateToken');
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
    return legacyBodyHandled('applyRetiredTriggerLegacyAttachToTargetCreatureYouControl');
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
    return legacyBodyHandled('applyRetiredTriggerLegacyGameStateOracleHooks');
  }

  const players = state.players || [];
  const opponents = players.filter((p: any) => p.id !== controller && !p.hasLost);
  const battlefield = state.battlefield || [];

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
    return legacyBodyHandled('applyRetiredTriggerLegacyThatPlayerSacrificesAndLosesLife');
  }

  if (applyRetiredTriggerLegacyChosenTypeTopCardReveal({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return legacyBodyHandled('applyRetiredTriggerLegacyChosenTypeTopCardReveal');
  }

  if (applyRetiredTriggerLegacyRevealTopCreatureOfChosenType({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return legacyBodyHandled('applyRetiredTriggerLegacyRevealTopCreatureOfChosenType');
  }

  if (applyRetiredTriggerLegacyUpkeepSacrificeCreatureOrSelf({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return legacyBodyHandled('applyRetiredTriggerLegacyUpkeepSacrificeCreatureOrSelf');
  }

  const triggerType = (triggerItem as any).triggerType;
  debug(2, `[executeTriggerEffect] triggerType=${triggerType}, sourceName=${sourceName}`);

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
    return legacyBodyHandled('applyRetiredTriggerLegacyJoinForcesAttack');
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
    return legacyBodyHandled('applyRetiredTriggerLegacyOptionalDiscardThenDraw');
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
    return legacyBodyHandled('applyRetiredTriggerLegacySacrificeAnotherPermanentForBenefit');
  }

  if (applyRetiredTriggerLegacyGenericSearchLibrary({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return legacyBodyHandled('applyRetiredTriggerLegacyGenericSearchLibrary');
  }

  if (applyRetiredTriggerLegacyRevealUntilEquipment({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return legacyBodyHandled('applyRetiredTriggerLegacyRevealUntilEquipment');
  }

  return {
    handled: false,
    ...buildTriggerEffectLegacyBodyContinuation(controller, sourceName, description, triggerItem, state),
  };
}
