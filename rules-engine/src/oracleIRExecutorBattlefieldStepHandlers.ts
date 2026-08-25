import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import { buildZoneObjectWithRetainedCounters } from '../../shared/src/zoneRetainedCounters';
import type { OracleBattlefieldObjectCondition, OracleEffectStep, OracleObjectSelector } from './oracleIR';
import { isEachPlayerMayPutCountersOnCreatureTheyControlStep } from './oracleIRCounterPlacement';
import { isPerPlayerOptionalOracleStep } from './oracleIRPerPlayerOptional';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  BattlefieldStepHandlerResult,
  RecentBattlefieldRuntime,
  StepApplyResult,
} from './oracleIRExecutorBattlefieldStepTypes';
import { applyTemporaryEffectToPermanents } from './oracleIRExecutorBattlefieldTemporaryEffects';
import { resolveRecentlyMovedBattlefieldPermanents } from './oracleIRExecutorBattlefieldRecentlyMoved';
import { resolveDeterministicArmyCreatureSelection } from './oracleIRExecutorBattlefieldArmySelection';
import { buildNameReferenceAliases } from './oracleIRExecutorBattlefieldNameAliases';
import {
  resolveDirectBattlefieldPermanents,
  resolveGrantTemporaryMassTargets,
} from './oracleIRExecutorBattlefieldPermanentSelectors';
import { normalizeSelfReferenceText } from './oracleIRExecutorBattlefieldSelfReference';
import { resolveAttachedStaticAbilityGrantTargets } from './oracleIRExecutorBattlefieldAttachedGrantTargets';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { readCharacteristicNumber } from './oracleIRExecutorBattlefieldCharacteristicNumber';
import { buildContextualBattlefieldTargetIds } from './oracleIRExecutorBattlefieldContextualTargets';
import {
  battlefieldPermanentHasFlying,
  battlefieldPermanentHasIslandwalk,
  isAttackingBattlefieldPermanent,
  permanentHasBattlefieldCounters,
  permanentHasColorLetter,
} from './oracleIRExecutorBattlefieldPermanentMatchers';
import { typeLineHasSubtype } from './oracleIRExecutorBattlefieldSubtypeUtils';
import {
  filterIllegalDirectTargetPermanents,
  resolveSubtypeOrCompoundBattlefieldPermanents,
} from './oracleIRExecutorBattlefieldSubtypeCompoundResolvers';
import {
  permanentIsAlly,
  permanentIsHistoric,
  permanentIsMonocolored,
  permanentIsOutlaw,
} from './oracleIRExecutorBattlefieldPermanentKindPredicates';
import { normalizeBattlefieldTargetReferenceText } from './oracleIRExecutorBattlefieldTargetReferenceText';
import {
  inferGrantTemporaryAbilityTargetFromRaw,
  normalizeGrantTemporaryAbilityTargetText,
} from './oracleIRExecutorBattlefieldGrantTemporaryTargetText';
import { registerTemporaryStaticAbilityGrant } from './oracleIRExecutorBattlefieldTemporaryStaticAbilityGrant';
import { resolveRecentlyCreatedTokenPermanents } from './oracleIRExecutorBattlefieldRecentlyCreatedTokens';
import { resolveEquippedCreaturesYouControl } from './oracleIRExecutorBattlefieldEquippedCreaturesYouControl';
import { buildAllAbleBlockerRequirementDescription } from './oracleIRExecutorBattlefieldForceBlockHelpers';
import { resolveDestroyTargets } from './oracleIRExecutorBattlefieldDestroyTargets';
import { grantAirbendPermissionToExiledCards } from './oracleIRExecutorBattlefieldAirbendPermission';
import { normalizeAnimatePermanentTargetText } from './oracleIRExecutorBattlefieldAnimateTargetText';
import { annotateBattlefieldExilesWithSource } from './oracleIRExecutorBattlefieldAnnotateExiles';
import { resolveAddCounterAmount } from './oracleIRExecutorBattlefieldAddCounterAmount';
import {
  addCountersToZoneCardsById,
  isContextualMovedCardReference,
  normalizeWhereQualifiedTarget,
  tryApplyDistributeCountersAmong,
} from './oracleIRExecutorBattlefieldAddCounterDistribute';
import { sacrificeStepResult } from './oracleIRExecutorBattlefieldSacrificeStepResult';
import {
  evaluateBattlefieldObjectCondition,
  registerDelayedBattlefieldAction,
} from './oracleIRExecutorBattlefieldDelayedActionHelpers';
import { collectSacrificeChoiceBoundIds } from './oracleIRExecutorBattlefieldSacrificeChoiceBoundIds';
import {
  findCardZoneLocation,
  getChosenObjectIdsFromContext,
  pickArtifactOrCreatureFromPlayerZone,
  resolveTargetOpponentPlayerId,
} from './oracleIRExecutorBattlefieldCardZoneLocation';
import {
  exileContextualThatCardFromPlayerZones,
  exileContextualSourceCardFromZone,
  exileTheChosenCardsFromPlayerZones,
  normalizeExileTargetReferenceText,
} from './oracleIRExecutorBattlefieldExileZoneHelpers';
import {
  isNamedSelfSacrificeReference,
  exileSourceStackObject,
  isStackSpellExileTarget,
  exileSpellFromStackById,
} from './oracleIRExecutorBattlefieldStackExileHelpers';
import { DISTRIBUTE_WORD_TO_NUMBER } from './oracleIRExecutorBattlefieldDistributeWordToNumber';
import { isSingularBattlefieldTargetText } from './oracleIRExecutorBattlefieldSingularTargetText';
import {
  normalizeBasicLandTypeName,
  setPermanentBasicLandType,
} from './oracleIRExecutorBattlefieldBasicLandType';
import {
  exileAllOpponentGraveyards,
  buildExileBattlefieldAppliedMetadata,
} from './oracleIRExecutorBattlefieldExileMetadataHelpers';
import { tryApplyGrantTemporaryAbilityEarlyCases } from './oracleIRExecutorBattlefieldGrantTemporaryAbilityEarlyCases';
import { appendPermanentTypes } from './oracleIRExecutorBattlefieldAppendPermanentTypes';
import {
  oracleIrBattlefieldRemovalOptions,
  buildPermanentCardWithStats,
} from './oracleIRExecutorBattlefieldRemovalHelpers';
import {
  parseContextualBattlefieldReference,
  resolveBoundSelectorMatches,
  resolveContextualBattlefieldPermanents,
} from './oracleIRExecutorBattlefieldContextualResolvers';
import {
  parseSimpleBattlefieldSelector,
  parseSimplePermanentTypeFromText,
  type SimpleBattlefieldSelector,
  type SimplePermanentType,
} from './oracleIRExecutorBattlefieldParser';
import { parseQuantity } from './oracleIRParserUtils';
import {
  cardMatchesType,
  moveTargetedCardFromExile,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
} from './oracleIRExecutorZoneOps';
import {
  applyTapOrUntapToBattlefield,
  permanentMatchesSelector,
  finalizeBattlefieldRemoval,
  moveMatchingBattlefieldPermanents,
  permanentMatchesType,
  resolveTapOrUntapTargetIds,
  type FinalizeBattlefieldRemovalOptions,
} from './oracleIRExecutorBattlefieldOps';
import { applyCounterDeltasToBattlefieldTargets } from './oracleIRExecutorCounterPlacementCommit';
import {
  createRegenerationShield,
  getAvailableShields,
  processDestructionWithRegeneration,
} from './keywordAbilities/regeneration';
import {
  DelayedTriggerTiming,
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  createWhenDealtDamageThisTurnTrigger,
  registerDelayedTrigger,
} from './delayedTriggeredAbilities';
import { createLastKnownPermanentSnapshot, type LastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';
import {
  resolveBolsterTargetCreatureIdFromBattlefield,
  getProcessedBattlefield,
  resolveCreatureTargetIds,
  resolveMentorTargetCreatureIdFromBattlefield,
  resolveSingleCreatureTargetId,
  applyTemporarySetBasePowerToughness,
  isMassTapOrUntapSelectorText,
} from './oracleIRExecutorCreatureStepUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import {
  getCardManaValue,
  getCardTypeLineLower,
  normalizeOracleText,
  quantityToNumber,
  resolvePlayers,
  resolveVotesReceivedQuantity,
} from './oracleIRExecutorPlayerUtils';
import {
  parseReferencedPossessiveZonePhrase,
  resolveReferencedObjectPlayerIds,
  resolveReferencedPlayerZone,
} from './oracleIRExecutorReferenceUtils';
import { resolveOracleQuantity } from './oracleIRExecutorResolveQuantity';
import { findAntecedentStepIndex } from './oracleIRStepLedger';
import { resolveThisWayAntecedentStepIndex } from './oracleIRThisWayBinding';
import {
  resolveCreatureCountExiledThisWay,
  resolveNonlandCountDiscardedThisWay,
} from './oracleIRThisWayResolver';
import { findCardsExiledWithSource } from './oracleIRExecutorZoneOps';
import { tryApplyExileTargetCardFromGraveyard } from './oracleIRExecutorExileGraveyardCardHandlers';
import { resolveOracleIrBoundTargetSpellId } from './oracleIrTargetBinding';
import { getStackItems } from './stackOperations';
import { canTargetPermanent } from './permanentTargeting';
import {
  trySpecialAddCounterStep,
  trySpecialCopyPermanentStep,
  trySpecialDestroyStep,
  trySpecialDoubleCountersStep,
  trySpecialExileStep,
  trySpecialMoveCountersStep,
  trySpecialRegenerateStep,
  trySpecialRemoveCounterStep,
  trySpecialSacrificeStep,
  trySpecialScheduleDelayedBattlefieldActionStep,
  trySpecialExertStep,
  trySpecialTurnFaceDownStep,
  trySpecialTapOrUntapStep,
  trySpecialForceBlockStep,
  trySpecialSuspectStep,
} from './oracleIRExecutorSpecialTargetHandlers';
import {
  effectiveStepTarget,
  resolveAttachedReferenceTargets,
  resolveMassCreatureRestrictionTargets,
  resolveTargetPrefixedPermanents,
} from './oracleIRExecutorExtendedTargetResolution';
import { AIRBEND_ALTERNATE_COST } from './keywordActions/airbend';
import { EARTHBENDED_PROPERTIES } from './keywordActions/earthbend';

import { bridgedZoneStepResult } from './oracleIRStepLedgerRuntime';
import { oracleIrBattlefieldRemovalBridgeOptions } from './oracleIRExecutorBattlefieldOps';
import {
  parseSacrificeWhat,
  extractSacrificeWhatText,
  sacrificeSelectorRequiresPlayerChoice,
  buildSacrificeTargetSelectionOptions,
  sacrificeRequiresAttackingCreature,
  isPermanentAttackingForSacrifice,
  resolveAttachmentReferencePermanents,
} from './oracleIRExecutorBattlefieldSacrificeWhat';

export {
  parseSacrificeWhat,
  extractSacrificeWhatText,
  sacrificeSelectorRequiresPlayerChoice,
  buildSacrificeTargetSelectionOptions,
};

export {
  applyRemoveFromCombatStep,
  applyPhaseOutStep,
  applyPutStickerStep,
  applyAssignNoCombatDamageStep,
  applyBecomeAuraStep,
  applyTapMatchingPermanentsStep,
} from './oracleIRExecutorBattlefieldPhaseCombatAuraSteps';

export { applyGainControlStep } from './oracleIRExecutorBattlefieldGainControlSteps';
export {
  applyAirbendStep,
  applyEarthbendStep,
  applyAnimatePermanentStep,
} from './oracleIRExecutorBattlefieldBendAndAnimateSteps';
export { applyDestroyStep } from './oracleIRExecutorBattlefieldDestroyStep';
export {
  applyExchangeControlStep,
  applyCopyPermanentStep,
} from './oracleIRExecutorBattlefieldExchangeAndCopySteps';
export { applyGainClassLevelStep } from './oracleIRExecutorBattlefieldGainClassLevelStep';
export { applyScheduleDelayedTriggerStep } from './oracleIRExecutorBattlefieldDelayedTriggerSteps';
export { applyExileStep } from './oracleIRExecutorBattlefieldExileStep';
export {
  applySacrificeStep,
  evaluateUnlessSacrificesStep,
} from './oracleIRExecutorBattlefieldSacrificeSteps';
export { applyScheduleDelayedBattlefieldActionStep } from './oracleIRExecutorBattlefieldDelayedBattlefieldActionStep';
export { applyRemoveCounterStep } from './oracleIRExecutorBattlefieldRemoveCounterStep';
export type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';




export { applyGrantStaticAbilityStep } from './oracleIRExecutorBattlefieldGrantStaticAbilityStep';

export {
  applyTapOrUntapStep,
  applySkipNextUntapStep,
  applyOptionalUntapChoiceStep,
} from './oracleIRExecutorBattlefieldTapUntapSteps';

export { applyGrantTemporaryDiesTriggerStep } from './oracleIRExecutorBattlefieldGrantTemporaryDiesTriggerStep';

export { applyGrantTemporaryAbilityStep } from './oracleIRExecutorBattlefieldGrantTemporaryAbilityStep';


export {
  applySuspectStep,
  applyDetainStep,
  applyCantBlockStep,
} from './oracleIRExecutorBattlefieldRestrictionSteps';

export { applyCantAttackStep } from './oracleIRExecutorBattlefieldCantAttackStep';

export { applyCantActivateAbilitiesStep } from './oracleIRExecutorBattlefieldCantActivateAbilitiesStep';

export {
  applyExertStep,
  applyBecomeRenownedStep,
  applyMonstrosityStep,
} from './oracleIRExecutorBattlefieldExertRenownedMonstrositySteps';

export {
  applyTurnFaceUpStep,
  applyTurnFaceDownStep,
} from './oracleIRExecutorBattlefieldTurnFaceSteps';

export {
  applySetBasicLandTypeStep,
  applyGrantLeaveBattlefieldReplacementStep,
} from './oracleIRExecutorBattlefieldBasicLandAndLeaveSteps';

export {
  applyDoubleCountersStep,
  applyMoveCountersStep,
} from './oracleIRExecutorBattlefieldDoubleMoveCountersSteps';

export { applyForceBlockStep } from './oracleIRExecutorBattlefieldForceBlockStep';

export function applyAddCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const normalizedTarget = normalizeWhereQualifiedTarget(step.target as any);
  const normalizedTargetText = String((normalizedTarget as any)?.text || '').trim().toLowerCase();
  const rawTargetText = String((step.target as any)?.text || '').trim().toLowerCase();
  const isAnotherCreatureYouControl = /^another target creature you control$/i.test(rawTargetText);

  const distributeResult = tryApplyDistributeCountersAmong(state, step, ctx, runtime);
  if (distributeResult) return distributeResult;

  if (
    isPerPlayerOptionalOracleStep(step) &&
    ctx.interactivePlayerChoices === true
  ) {
    return {
      applied: false,
      message: `Skipped add counter (needs per-player choice): ${step.raw}`,
      reason: 'player_choice_required',
    };
  }

  if (/commander creature you control/i.test(String(step.raw || ''))) {
    const controllerId = String(ctx.controllerId || '').trim();
    const counterAmount = resolveAddCounterAmount(state, step, ctx, runtime) ?? Number(ctx.referenceAmount ?? 1);
    const counterName = String(step.counter || '+1/+1').trim();
    const boundIds = collectBoundBattlefieldIds(ctx);
    const commanders = ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      return (
        Boolean((perm as any)?.isCommander) ||
        /\bcommander\b/i.test(getExecutorTypeLineLower(perm))
      );
    });
    const target =
      commanders.find((perm: any) => boundIds.includes(String(perm?.id || '').trim())) || commanders[0];
    if (!target) {
      return {
        applied: false,
        message: `Skipped add counter (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const targetId = String((target as any)?.id || '').trim();
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.id || '').trim() !== targetId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + counterAmount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Added ${counterAmount} ${counterName} counter(s) to commander creature`],
    };
  }

  if (/luck counters on this permanent equal to the result/i.test(String(step.raw || ''))) {
    const sourceId = String(ctx.sourceId || '').trim();
    const amount = resolveAddCounterAmount(state, step, ctx, runtime) ?? Number(ctx.referenceAmount ?? 1);
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.id || '').trim() !== sourceId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters.luck = (Number(counters.luck ?? 0) || 0) + amount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Added ${amount} luck counter(s) to source permanent`],
    };
  }

  if (/equal to the difference/i.test(String(step.raw || ''))) {
    const controllerId = String(ctx.controllerId || '').trim();
    const counterAmount = resolveAddCounterAmount(state, step, ctx, runtime) ?? Number(ctx.referenceAmount ?? 1);
    const counterName = String(step.counter || '+1/+1').trim();
    const sourceId = String(ctx.sourceId || '').trim();
    const target =
      (sourceId
        ? ((state.battlefield || []) as BattlefieldPermanent[]).find(
            (perm: any) => String(perm?.id || '').trim() === sourceId
          )
        : undefined) ||
      ((state.battlefield || []) as BattlefieldPermanent[]).find(
        (perm: any) =>
          String(perm?.controller || '').trim() === controllerId && permanentMatchesType(perm, 'creature')
      );
    if (!target) {
      return {
        applied: false,
        message: `Skipped add counter (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const targetId = String((target as any)?.id || '').trim();
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.id || '').trim() !== targetId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + counterAmount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Added ${counterAmount} ${counterName} counter(s) equal to the difference`],
    };
  }

  if (/^each creature you control of (?:that|the chosen) type$/i.test(normalizedTargetText)) {
    const chosenType = String(ctx.selectorContext?.chosenCreatureType || '').trim().toLowerCase();
    if (!chosenType) {
      return {
        applied: false,
        message: `Skipped add counter (requires chosen creature type): ${step.raw}`,
        reason: 'player_choice_required',
      };
    }
    const counterName = String(step.counter || '+1/+1').trim();
    const amountValue = resolveAddCounterAmount(state, step, ctx, runtime) ?? 1;
    const targets = ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) =>
      permanentMatchesSelector(
        perm,
        { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
        ctx,
      ) && typeLineHasSubtype(perm, chosenType),
    );
    const targetIds = new Set(targets.map((target: any) => String(target?.id || '').trim()).filter(Boolean));
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (!targetIds.has(String(perm?.id || '').trim())) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + amountValue;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Added ${amountValue} ${counterName} counter(s) to ${targets.length} creature(s) of type ${chosenType}`],
    };
  }

  const special = trySpecialAddCounterStep(state, step, ctx);
  if (special) return special;

  if (
    /^it$/i.test(normalizedTargetText) ||
    /^put (?:two|three|four|five|six|seven|eight|nine|ten|\d+|x|\w+) \+1\/\+1 counters on it$/i.test(
      String(step.raw || '').trim()
    )
  ) {
    const contextualIds = buildContextualBattlefieldTargetIds(
      (state.battlefield || []) as BattlefieldPermanent[],
      ctx,
      false
    );
    const targets = ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) =>
      contextualIds.includes(String((perm as any)?.id || '').trim())
    );
    if (targets.length > 0) {
      const counterAmount = resolveAddCounterAmount(state, step, ctx, runtime) ?? 1;
      const counterName = String(step.counter || '+1/+1').trim();
      const targetIds = new Set(targets.map((target: any) => String(target?.id || '').trim()).filter(Boolean));
      const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
        if (!targetIds.has(String(perm?.id || '').trim())) return perm;
        const counters = { ...((perm?.counters || {}) as Record<string, number>) };
        counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + counterAmount;
        return { ...perm, counters };
      });
      return {
        applied: true,
        state: { ...(state as any), battlefield: nextBattlefield } as GameState,
        log: [`Added ${counterAmount} ${counterName} counter(s) to ${targets.length} permanent(s)`],
      };
    }
  }

  if (/^put two loyalty counters on a planeswalker you control$/i.test(String(step.raw || '').trim())) {
    const controllerId = String(ctx.controllerId || '').trim();
    const planeswalkers = ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
      return permanentMatchesType(perm, 'planeswalker');
    });
    const target =
      planeswalkers.find((perm: any) => collectBoundBattlefieldIds(ctx).includes(String((perm as any)?.id || '').trim())) ||
      planeswalkers[0];
    if (target) {
      const counterName = String(step.counter || 'loyalty').trim();
      const targetId = String((target as any)?.id || '').trim();
      const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== targetId) return perm;
        const counters = { ...((perm?.counters || {}) as Record<string, number>) };
        counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + 2;
        return { ...perm, counters };
      });
      return {
        applied: true,
        state: { ...(state as any), battlefield: nextBattlefield } as GameState,
        log: [`Added 2 ${counterName} counter(s) to planeswalker`],
      };
    }
    return { applied: true, state, log: ['No planeswalker to receive loyalty counters'] };
  }

  if (/^(?:each of )?up to x target creatures$/i.test(normalizedTargetText)) {
    const maxCount = Number.isFinite(Number(ctx.xValue)) ? Math.max(0, Number(ctx.xValue)) : 1;
    const boundIds = collectBoundBattlefieldIds(ctx);
    const matches = ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      return boundIds.includes(id) && permanentMatchesType(perm, 'creature');
    });
    const targets = maxCount > 0 ? matches.slice(0, maxCount) : [];
    if (targets.length === 0) {
      return { applied: true, state, log: ['No matching creatures for counters'] };
    }
    const counterName = String(step.counter || '+1/+1').trim();
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (!targets.some((target: any) => String(target?.id || '').trim() === String(perm?.id || '').trim())) {
        return perm;
      }
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + 1;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Added 1 ${counterName} counter(s) to ${targets.length} creature(s)`],
    };
  }

  const amountValue = resolveAddCounterAmount(state, step, ctx, runtime);
  if (amountValue === null || amountValue <= 0) {
    return {
      applied: false,
      message: `Skipped add counter (unsupported amount): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const counterName = String(step.counter || '').trim();
  if (!counterName) {
    return {
      applied: false,
      message: `Skipped add counter (unsupported counter): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  if (/^each of those permanents$/i.test(rawTargetText) || /^each of those permanents$/i.test(normalizedTargetText)) {
    const antecedentIds = [
      ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds)
        ? ctx.lastAntecedentBattlefieldPermanentIds
        : []),
      ...(Array.isArray(ctx.selectorContext?.lastAntecedentBattlefieldPermanentIds)
        ? ctx.selectorContext.lastAntecedentBattlefieldPermanentIds
        : []),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    if (antecedentIds.length === 0) {
      return { applied: true, state, log: ['No antecedent permanents for each-of-those counters'] };
    }
    const antecedentSet = new Set(antecedentIds);
    const targets = ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) =>
      antecedentSet.has(String(perm?.id || '').trim()),
    );
    if (targets.length === 0) {
      return {
        applied: false,
        message: `Skipped add counter (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const counterAmount = resolveAddCounterAmount(state, step, ctx, runtime);
    if (counterAmount === null || counterAmount <= 0) {
      return {
        applied: false,
        message: `Skipped add counter (unsupported amount): ${step.raw}`,
        reason: 'unsupported_target',
      };
    }
    const antecedentCounterName = String(step.counter || '+1/+1').trim();
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (!antecedentSet.has(String(perm?.id || '').trim())) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[antecedentCounterName] = (Number(counters[antecedentCounterName] ?? 0) || 0) + counterAmount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Added ${counterAmount} ${antecedentCounterName} counter(s) to ${targets.length} permanent(s)`],
      lastAntecedentBattlefieldPermanentIds: antecedentIds,
    };
  }

  if (/^each of them$/i.test(rawTargetText) || /^each of them$/i.test(normalizedTargetText)) {
    const contextualCards = Array.isArray(runtime?.lastExiledCards) && runtime.lastExiledCards.length > 0
      ? runtime.lastExiledCards
      : Array.isArray(runtime?.lastMovedCards)
        ? runtime.lastMovedCards
        : [];
    if (contextualCards.length === 0) {
      return { applied: true, state, log: ['No contextual cards for each-of-them counters'] };
    }
    const stepRaw = String(step.raw || '');
    const wantsLoyalty = /loyalty counter/i.test(stepRaw);
    let workingState = state;
    const logs: string[] = [];
    const creatureIds = contextualCards
      .filter((card: any) => getCardTypeLineLower(card).includes('creature'))
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    if (creatureIds.length > 0) {
      const creatureUpdate = addCountersToZoneCardsById(workingState, creatureIds, counterName, amountValue);
      workingState = creatureUpdate.state;
      if (creatureUpdate.updatedCount > 0) {
        logs.push(`Added ${amountValue} ${counterName} counter(s) to ${creatureUpdate.updatedCount} creature(s)`);
      }
    }
    if (wantsLoyalty) {
      const planeswalkerIds = contextualCards
        .filter((card: any) => getCardTypeLineLower(card).includes('planeswalker'))
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean);
      if (planeswalkerIds.length > 0) {
        const loyaltyUpdate = addCountersToZoneCardsById(workingState, planeswalkerIds, 'loyalty', amountValue);
        workingState = loyaltyUpdate.state;
        if (loyaltyUpdate.updatedCount > 0) {
          logs.push(`Added ${amountValue} loyalty counter(s) to ${loyaltyUpdate.updatedCount} planeswalker(s)`);
        }
      }
    }
    return {
      applied: true,
      state: workingState,
      log: logs.length > 0 ? logs : ['Applied each-of-them enters-with counters'],
    };
  }

  const recentTokenTargets = resolveRecentlyCreatedTokenPermanents(
    (state.battlefield || []) as BattlefieldPermanent[],
    normalizedTarget as any,
    runtime
  );
  const recentMovedTargets = recentTokenTargets.length > 0
    ? []
    : resolveRecentlyMovedBattlefieldPermanents(
        (state.battlefield || []) as BattlefieldPermanent[],
        normalizedTarget as any,
        runtime
      );
  const shouldPreferMovedCards =
    isContextualMovedCardReference(normalizedTarget as any) &&
    Array.isArray(runtime?.lastMovedCards) &&
    runtime.lastMovedCards.length > 0;
  const directTargets =
    isAnotherCreatureYouControl || recentTokenTargets.length > 0 || recentMovedTargets.length > 0
      ? []
      : shouldPreferMovedCards
        ? []
        : resolveDirectBattlefieldPermanents(
            (state.battlefield || []) as BattlefieldPermanent[],
            normalizedTarget as any,
            ctx
          );
  const targets = recentTokenTargets.length > 0
    ? recentTokenTargets
    : recentMovedTargets.length > 0
      ? recentMovedTargets
      : directTargets;
  const anotherTargetMatch = String((normalizedTarget as any)?.text || '')
    .trim()
    .toLowerCase()
    .match(/^another target creature you control$|^target creature you control$/);
  const anotherCreatureTargets =
    isAnotherCreatureYouControl || (targets.length === 0 && anotherTargetMatch)
      ? ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) => {
          const permanentId = String((perm as any)?.id || '').trim();
          const sourceId = String(ctx.sourceId || '').trim();
          if (!permanentId || permanentId === sourceId) return false;
          if (!collectBoundBattlefieldIds(ctx).includes(permanentId)) return false;
          return permanentMatchesType(perm, 'creature');
        })
      : [];
  const fallbackSingleCreatureId =
    targets.length === 0 && anotherCreatureTargets.length === 0 && !shouldPreferMovedCards
    ? resolveSingleCreatureTargetId(state, normalizedTarget as any, ctx)
    : undefined;
  const fallbackCreatureTargets = fallbackSingleCreatureId
    ? ((state.battlefield || []) as BattlefieldPermanent[]).filter(
        permanent => String((permanent as any)?.id || '').trim() === fallbackSingleCreatureId
      )
    : [];
  const resolvedTargets =
    targets.length > 0
      ? targets
      : anotherCreatureTargets.length > 0
        ? anotherCreatureTargets.slice(0, 1)
        : fallbackCreatureTargets;

  if (resolvedTargets.length === 0 && isContextualMovedCardReference(normalizedTarget as any)) {
    const movedCardIds = Array.isArray(runtime?.lastMovedCards)
      ? runtime.lastMovedCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean)
      : [];
    const uniqueMovedCardIds = Array.from(new Set(movedCardIds));

    if (uniqueMovedCardIds.length === 1) {
      const movedCardUpdate = addCountersToZoneCardsById(state, uniqueMovedCardIds, counterName, amountValue);
      if (movedCardUpdate.updatedCount > 0) {
        const nextMovedCards = Array.isArray(runtime?.lastMovedCards)
          ? runtime.lastMovedCards.map((card: any) => {
              const cardId = String(card?.id || '').trim();
              if (!cardId || !uniqueMovedCardIds.includes(cardId)) return card;
              const counters = { ...((card?.counters || {}) as Record<string, number>) };
              const currentCount = Number(counters[counterName] ?? 0);
              counters[counterName] = (Number.isFinite(currentCount) ? currentCount : 0) + amountValue;
              return { ...card, counters };
            })
          : undefined;

        return {
          applied: true,
          state: movedCardUpdate.state,
          log: [`Added ${amountValue} ${counterName} counter(s) to ${movedCardUpdate.updatedCount} moved card(s)`],
          ...(nextMovedCards ? { lastMovedCards: nextMovedCards } : {}),
        };
      }
    }
  }

  if (resolvedTargets.length === 0) {
    if (isContextualMovedCardReference(normalizedTarget as any)) {
      const movedCardIds = Array.isArray(runtime?.lastMovedCards)
        ? runtime.lastMovedCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean)
        : [];
      const uniqueMovedCardIds = Array.from(new Set(movedCardIds));
      if (uniqueMovedCardIds.length !== 1) {
        return {
          applied: false,
          message: `Skipped add counter (no deterministic target): ${step.raw}`,
          reason: 'no_deterministic_target',
        };
      }

      const zoneUpdate = addCountersToZoneCardsById(state, uniqueMovedCardIds, counterName, amountValue);
      if (zoneUpdate.updatedCount <= 0) {
        return {
          applied: false,
          message: `Skipped add counter (no deterministic target): ${step.raw}`,
          reason: 'no_deterministic_target',
        };
      }

      const nextMovedCards = Array.isArray(runtime?.lastMovedCards)
        ? runtime.lastMovedCards.map((card: any) => {
            const cardId = String(card?.id || '').trim();
            if (!cardId || !uniqueMovedCardIds.includes(cardId)) return card;
            const counters = { ...((card?.counters || {}) as Record<string, number>) };
            const currentCount = Number(counters[counterName] ?? 0);
            counters[counterName] = (Number.isFinite(currentCount) ? currentCount : 0) + amountValue;
            return { ...card, counters };
          })
        : undefined;

      return {
        applied: true,
        state: zoneUpdate.state,
        log: [`Added ${amountValue} ${counterName} counter(s) to ${zoneUpdate.updatedCount} moved card(s)`],
        ...(nextMovedCards ? { lastMovedCards: nextMovedCards } : {}),
      };
    }

    return {
      applied: false,
      message: `Skipped add counter (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const targetIds = Array.from(
    new Set(resolvedTargets.map((target: any) => String(target?.id || '').trim()).filter(Boolean)),
  );

  const counterResult = applyCounterDeltasToBattlefieldTargets(
    state,
    targetIds,
    counterName,
    amountValue,
    ctx,
    'add_counter',
  );
  if (counterResult.halted) {
    return {
      applied: false,
      message: `Skipped add counter (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
    };
  }

  return {
    applied: true,
    state: counterResult.state,
    log: counterResult.log,
    lastMovedBattlefieldPermanentIds: targetIds,
    ...(counterResult.skipLedgerFlush ? { skipLedgerFlush: true } : {}),
  };
}

export {
  applyAddTypesStep,
  applyRemoveMarkedDamageStep,
  applyRegenerateStep,
} from './oracleIRExecutorBattlefieldAddTypesHealRegenerateSteps';




