import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import {
  applyOracleIRStepsToGameState,
  buildOracleIRExecutionContext,
  type OracleIRExecutionResult,
} from '../../../../rules-engine/src/oracleIRExecutor.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import {
  applyMillReplacementEffectsToSteps,
  applyOracleIRStepsOnServer,
  buildShadowProbeContext,
  hydrateOracleIRPlayerZonesFromContext,
} from './oracleIrServerZoneSync.js';
import { logOracleIrAllOrNothingFailure } from './oracleIrStepWiring.js';
import {
  describeOracleIrTriggerPrimaryIncomplete,
  readTriggeringSpellManaValue,
  triggerCopyStepsNeedServerTargetQueue,
} from './oracleIrTriggerPrimaryIncompleteReasons.js';
import { isOracleIrExecutionHandled } from './oracleIrSpellExecution.js';
import { isOracleIrContinuationBridged } from './oracleIrContinuationBridge.js';
import {
  buildTriggerExecutionOptionsFromSteps,
  collectTriggerExecutionSteps,
} from './oracleIrTriggerExecutionHelpers.js';
import {
  probeOracleEffectProgramShadow,
  requiresTriggerEffectProgramOrchestration,
  startOracleEffectProgramOnServer,
} from './oracleIrEffectProgramServer.js';
import { copyPermanentTriggerStepNeedsTargetSelectionQueue } from './trigger-copy-permanent.js';
import { recordDoThisOnlyOnceEachTurnOnAccept } from './triggerDoThisOnlyOnceEachTurn.js';
import { getActualPowerToughness } from '../utils.js';
import { getCurrentPowerToughnessForRules, withCurrentPowerToughnessHook } from './currentPowerToughness.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { isOracleIrTriggerPrimaryEnabled } from './oracleIrFeatureFlags.js';
import { isTriggerEffectOwnedByOracleIrPrimary } from './oracleIrTriggerLegacyRouting.js';
import {
  isJoinForcesTriggerEffect,
  queueJoinForcesResolutionSteps,
} from './joinForcesResolutionQueue.js';
import { normalizeTriggerEffectDescriptionForExecution } from './trigger-runtime-wiring.js';
import { findTriggeringSpellOnStack, stackObjectIdsMatch } from './triggerCastSpellStackBinding.js';

export { isOracleIrTriggerPrimaryEnabled } from './oracleIrFeatureFlags.js';

export interface TryResolveTriggerViaOracleIRParams {
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly effectText: string;
  readonly triggerItem?: any;
  readonly sourceImage?: string;
}

export interface TryResolveTriggerViaOracleIRResult {
  readonly handled: boolean;
  readonly applied: number;
  readonly shadowWouldHandle: boolean;
}

function resolveTriggerTargetBinding(
  ctx: GameContext,
  triggerItem: any | undefined,
  controller: PlayerID,
): {
  targetPermanentId?: string;
  targetPlayerId?: PlayerID;
  targetSpellId?: string;
  chosenObjectIds?: readonly string[];
  sourcePermanentId?: string;
  sourceId?: string;
  referenceAmount?: number;
  xValue?: number;
  spellManaValue?: number;
} {
  const state = (ctx as any).state;
  const targets = Array.isArray(triggerItem?.targets) ? triggerItem.targets : [];
  let targetPlayerId = String(
    targets[0]?.id || targets[0] || triggerItem?.targetPlayerId || '',
  ).trim() as PlayerID;
  const knownPlayerIds = new Set(
    (Array.isArray(state?.players) ? state.players : [])
      .map((player: any) => String(player?.id || '').trim())
      .filter(Boolean),
  );
  if (targetPlayerId && !knownPlayerIds.has(targetPlayerId)) {
    targetPlayerId = '' as PlayerID;
  }

  if (!targetPlayerId) {
    const players = Array.isArray(state?.players) ? state.players : [];
    const playerIds = new Set(players.map((player: any) => String(player?.id || '')).filter(Boolean));
    for (const targetId of targets.map((target: any) => String(target || '').trim()).filter(Boolean)) {
      if (playerIds.has(targetId)) {
        targetPlayerId = targetId as PlayerID;
        break;
      }
    }
    const explicitTargetPlayer = String(triggerItem?.targetPlayer || '').trim();
    if (!targetPlayerId && explicitTargetPlayer && playerIds.has(explicitTargetPlayer)) {
      targetPlayerId = explicitTargetPlayer as PlayerID;
    }
    const triggerValue = (triggerItem as any)?.value;
    const defendingPlayerId = String(
      triggerItem?.defendingPlayer
        || triggerItem?.effectData?.defendingPlayerId
        || triggerItem?.effectData?.defendingPlayer
        || (triggerValue && typeof triggerValue === 'object' ? triggerValue.defendingPlayerId : '')
        || (triggerValue && typeof triggerValue === 'object' ? triggerValue.defendingPlayer : '')
        || '',
    ).trim();
    if (!targetPlayerId && defendingPlayerId && playerIds.has(defendingPlayerId)) {
      targetPlayerId = defendingPlayerId as PlayerID;
    }
    const triggeringPlayer = String(triggerItem?.triggeringPlayer || '').trim();
    if (!targetPlayerId && triggeringPlayer && playerIds.has(triggeringPlayer)) {
      targetPlayerId = triggeringPlayer as PlayerID;
    }
  }

  const sourcePermanentId = String(
    triggerItem?.source || triggerItem?.permanentId || '',
  ).trim();

  if (!targetPlayerId && sourcePermanentId) {
    const sourcePermanent = (state?.battlefield || []).find(
      (permanent: any) => String(permanent?.id || '').trim() === sourcePermanentId,
    ) as any;
    const attackingPlayerId = String(sourcePermanent?.attacking || '').trim();
    if (attackingPlayerId && !attackingPlayerId.startsWith('perm_')) {
      targetPlayerId = attackingPlayerId as PlayerID;
    }
    const enchantedTarget = String(
      sourcePermanent?.attachedTo
        || sourcePermanent?.enchanting
        || sourcePermanent?.enchantedPlayerId
        || '',
    ).trim();
    if (enchantedTarget) {
      targetPlayerId = enchantedTarget as PlayerID;
    }
  }

  if (!targetPlayerId) {
    const defendingPlayerId = String(
      triggerItem?.defendingPlayer
        || triggerItem?.effectData?.defendingPlayer
        || '',
    ).trim();
    if (defendingPlayerId && !defendingPlayerId.startsWith('perm_')) {
      targetPlayerId = defendingPlayerId as PlayerID;
    }
  }

  const sourceId = String(sourcePermanentId || triggerItem?.sourceId || triggerItem?.id || '').trim();
  const triggeringStackItemId = String(
    triggerItem?.triggeringStackItemId
    || triggerItem?.effectData?.triggeringStackItemId
    || '',
  ).trim();
  const lifeLostReference = Number(triggerItem?.effectData?.lifeLost ?? 0);
  const lifePaidReference = Number(triggerItem?.effectData?.lifePaid ?? 0);
  const countersPlacedReference = Number(triggerItem?.effectData?.countersPlaced ?? 0);
  const snapshottedReference = Number(
    triggerItem?.referenceAmount
    ?? triggerItem?.value?.attachedAuraCount
    ?? triggerItem?.effectData?.attachedAuraCount
    ?? 0,
  );
  const damageReference = Number(
    triggerItem?.damageAmount ?? triggerItem?.effectData?.damageAmount ?? 0,
  );
  const lifeGainedReference = String(triggerItem?.triggerType || '') === 'lifegain'
    ? Number(triggerItem?.effectData?.lifeGained ?? 0)
    : 0;
  const losingPlayerId = String(
    triggerItem?.effectData?.losingPlayerId
      || triggerItem?.triggeringPlayer
      || triggerItem?.targetPlayer
      || '',
  ).trim() as PlayerID;

  const normalizedTargetIds = targets
    .map((targetRef: any) => (typeof targetRef === 'string' ? targetRef : String(targetRef?.id || '')))
    .filter(Boolean);

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const players = Array.isArray(state?.players) ? state.players : [];
  const stack = Array.isArray(state?.stack) ? state.stack : [];

  let targetPermanentId: string | undefined;
  let targetSpellId: string | undefined;
  if (triggeringStackItemId) {
    const stamped = stack.find((stackItem: any) => (
      stackObjectIdsMatch(String(stackItem?.id || ''), triggeringStackItemId)
      || stackObjectIdsMatch(String(stackItem?.card?.id || ''), triggeringStackItemId)
    ));
    if (stamped) {
      targetSpellId = String(stamped.id || '').trim() || undefined;
    } else {
      // Keep the bound id even if the object already left the stack so copy
      // effects (Hive Mind) use last-known information instead of another spell.
      targetSpellId = triggeringStackItemId;
    }
  }
  if (!targetSpellId) {
    const boundSpell = findTriggeringSpellOnStack(state, triggerItem);
    if (boundSpell) {
      targetSpellId = String(boundSpell.id || '').trim() || undefined;
      const boundCaster = String(boundSpell.controller || '').trim();
      if (!targetPlayerId && boundCaster) {
        targetPlayerId = boundCaster as PlayerID;
      }
    }
  }
  for (const targetId of normalizedTargetIds) {
    if (battlefield.some((permanent: any) => String(permanent?.id || '') === targetId)) {
      targetPermanentId = targetId;
      break;
    }
    if (stack.some((stackItem: any) => String(stackItem?.id || '') === targetId)) {
      targetSpellId = targetId;
      break;
    }
    if (players.some((player: any) => String(player?.id || '') === targetId)) {
      targetPlayerId = targetId as PlayerID;
      break;
    }
  }

  const interveningSubjectPermanentId = String(
    triggerItem?.interveningIfSubjectPermanentId || '',
  ).trim();
  // Damage-received watchers retain the object that was dealt damage in
  // effectData. Bind it as the pronoun antecedent for effects such as
  // "put a +1/+1 counter on it"; the watcher itself remains the source for
  // "this creature" / "this permanent".
  const damagedPermanentId = String(
    triggerItem?.effectData?.damagedPermanentId
      || triggerItem?.effectData?.targetPermanentId
      || '',
  ).trim();
  const discardedCardId = String(triggerItem?.effectData?.discardedCardId || '').trim();
  const boundGraveyardCardId = String(triggerItem?.boundGraveyardCardId || '').trim();
  const createdTokenIds = Array.isArray(triggerItem?.effectData?.createdTokenIds)
    ? triggerItem.effectData.createdTokenIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : [];
  // Becomes-untapped watchers retain the object that untapped in effectData.
  // Bind it as the pronoun antecedent for "that permanent's controller mills".
  const untappedPermanentId = String(triggerItem?.effectData?.untappedPermanentId || '').trim();
  const untappedPermanentController = String(
    triggerItem?.effectData?.untappedPermanentController || '',
  ).trim() as PlayerID;
  // Attack watchers (Vengeful Ancestor "whenever a goaded creature attacks")
  // stamp the attacking creature so "it deals 1 damage to its controller" binds.
  const attackingCreatureId = String(triggerItem?.effectData?.attackingCreatureId || '').trim();
  const chosenObjectIds = Array.from(new Set([
    ...normalizedTargetIds,
    ...(interveningSubjectPermanentId ? [interveningSubjectPermanentId] : []),
    ...(damagedPermanentId ? [damagedPermanentId] : []),
    ...(untappedPermanentId ? [untappedPermanentId] : []),
    ...(attackingCreatureId ? [attackingCreatureId] : []),
    ...(discardedCardId ? [discardedCardId] : []),
    ...(boundGraveyardCardId ? [boundGraveyardCardId] : []),
    ...createdTokenIds,
  ]));
  if (
    !targetPermanentId
    && interveningSubjectPermanentId
    && battlefield.some((permanent: any) => String(permanent?.id || '') === interveningSubjectPermanentId)
  ) {
    targetPermanentId = interveningSubjectPermanentId;
  }
  if (
    !targetPermanentId
    && damagedPermanentId
    && battlefield.some((permanent: any) => String(permanent?.id || '') === damagedPermanentId)
  ) {
    targetPermanentId = damagedPermanentId;
  }
  if (
    !targetPermanentId
    && untappedPermanentId
    && battlefield.some((permanent: any) => String(permanent?.id || '') === untappedPermanentId)
  ) {
    targetPermanentId = untappedPermanentId;
  }
  if (
    !targetPermanentId
    && attackingCreatureId
    && battlefield.some((permanent: any) => String(permanent?.id || '') === attackingCreatureId)
  ) {
    targetPermanentId = attackingCreatureId;
  }
  if (!targetPlayerId && untappedPermanentController) {
    const playerIds = new Set(players.map((player: any) => String(player?.id || '')).filter(Boolean));
    if (playerIds.has(untappedPermanentController)) {
      targetPlayerId = untappedPermanentController;
    }
  }
  if (!targetPermanentId) {
    const dyingId = String(triggerItem?.dyingCreature?.id || triggerItem?.value?.dyingPermanentId || '').trim();
    if (dyingId) targetPermanentId = dyingId;
  }

  let xValue = typeof triggerItem?.xValue === 'number' ? triggerItem.xValue : undefined;
  const spellManaValue = readTriggeringSpellManaValue(state, triggerItem, targetSpellId);
  if (typeof xValue !== 'number' || !Number.isFinite(xValue)) {
    const effect = String(triggerItem?.effect || triggerItem?.description || '');
    const statMatch = effect.match(/where\s+x\s+is\s+that\s+creature(?:'|’)?s\s+(power|toughness)/i);
    if (statMatch) {
      const subjectId = interveningSubjectPermanentId || String(targetPermanentId || '').trim();
      const onBattlefield = battlefield.find((permanent: any) => String(permanent?.id || '') === subjectId);
      const subject = onBattlefield || triggerItem?.interveningIfSubjectSnapshot;
      if (subject) {
        // Battlefield creature: current P/T. Snapshot (left the battlefield): recorded values.
        const pt = onBattlefield
          ? getCurrentPowerToughnessForRules(onBattlefield, state)
          : getActualPowerToughness(subject, state);
        const bound = String(statMatch[1] || '').toLowerCase() === 'power' ? pt.power : pt.toughness;
        if (Number.isFinite(bound)) {
          xValue = Math.max(0, Math.floor(Number(bound)));
        }
      }
    }
    if (
      (typeof xValue !== 'number' || !Number.isFinite(xValue))
      && /where\s+x\s+is\s+that\s+spell(?:'|’)?s\s+mana\s+value/i.test(effect)
      && typeof spellManaValue === 'number'
    ) {
      xValue = spellManaValue;
    }
  }

  return {
    targetPermanentId,
    targetPlayerId: (targetPlayerId || losingPlayerId || undefined) as PlayerID | undefined,
    targetSpellId,
    chosenObjectIds: chosenObjectIds.length > 0 ? chosenObjectIds : undefined,
    sourcePermanentId: sourcePermanentId || undefined,
    sourceId: sourceId || undefined,
    referenceAmount:
      Number.isFinite(lifeLostReference) && lifeLostReference > 0
        ? lifeLostReference
        : Number.isFinite(lifePaidReference) && lifePaidReference > 0
          ? lifePaidReference
          : Number.isFinite(countersPlacedReference) && countersPlacedReference > 0
            ? countersPlacedReference
            : Number.isFinite(snapshottedReference) && snapshottedReference > 0
              ? snapshottedReference
              : Number.isFinite(damageReference) && damageReference > 0
                ? damageReference
                : Number.isFinite(lifeGainedReference) && lifeGainedReference > 0
                  ? lifeGainedReference
                  : undefined,
    xValue,
    spellManaValue,
  };
}

/** Last-known snapshots of permanents sacrificed to put this reflexive trigger on the stack (Surtland Flinger). */
function sacrificedSnapshotsFromTriggerItem(triggerItem: any): any[] {
  const snapshots = triggerItem?.lastSacrificedPermanents;
  if (!Array.isArray(snapshots)) return [];
  return snapshots.filter((entry: any) => entry && typeof entry === 'object').map((entry: any) => ({ ...entry }));
}

function buildTriggerIrContext(
  params: TryResolveTriggerViaOracleIRParams,
  binding: ReturnType<typeof resolveTriggerTargetBinding>,
  state?: any,
) {
  const selectedModeIds = Array.isArray(params.triggerItem?.selectedModeIds)
    ? params.triggerItem.selectedModeIds
    : Array.isArray(params.triggerItem?.selectedModes)
      ? params.triggerItem.selectedModes
      : undefined;

  const explicitDefendingPlayerId = String(
    params.triggerItem?.defendingPlayer
      || params.triggerItem?.effectData?.defendingPlayerId
      || params.triggerItem?.effectData?.defendingPlayer
      || '',
  ).trim();
  const defendingOpponentId = (explicitDefendingPlayerId && explicitDefendingPlayerId !== String(params.controller)
    ? explicitDefendingPlayerId
    : (binding.targetPlayerId && String(binding.targetPlayerId) !== String(params.controller)
      ? binding.targetPlayerId
      : undefined)) as PlayerID | undefined;
  const sourcePermanentId = String(binding.sourcePermanentId || binding.sourceId || '').trim();
  const sourcePermanent = sourcePermanentId
    ? (state?.battlefield || []).find((entry: any) => entry && String(entry.id || '') === sourcePermanentId)
    : undefined;
  const enteredFromZone = String(
    sourcePermanent?.enteredFromZone
    || (sourcePermanent?.enteredFromGraveyard ? 'graveyard' : '')
    || sourcePermanent?.card?.enteredFromZone
    || (sourcePermanent?.card?.enteredFromGraveyard ? 'graveyard' : '')
    || '',
  ).trim().toLowerCase();
  const stampedCastFromHand = (sourcePermanent as any)?.castFromHand ?? (sourcePermanent as any)?.card?.castFromHand;
  const castFromZone = String(
    sourcePermanent?.castSourceZone
    || sourcePermanent?.castFromZone
    || sourcePermanent?.card?.castSourceZone
    || sourcePermanent?.card?.castFromZone
    || (stampedCastFromHand === true ? 'hand' : '')
    || '',
  ).trim().toLowerCase();
  const chosenCreatureType = String(
    params.triggerItem?.chosenCreatureType
    || params.triggerItem?.card?.chosenCreatureType
    || sourcePermanent?.chosenCreatureType
    || '',
  ).trim();
  const attackingPlayerId = String(
    params.triggerItem?.attackingPlayerId
      || params.triggerItem?.effectData?.attackingPlayerId
      || '',
  ).trim();
  const attachedToId = String(
    params.triggerItem?.effectData?.attachedToId
    || sourcePermanent?.attachedTo
    || sourcePermanent?.enchanting
    || '',
  ).trim();
  const resolvedTargetPermanentId = String(binding.targetPermanentId || attachedToId || '').trim();
  const resolvedTargetIsCreature = Boolean(
    resolvedTargetPermanentId
    && (state?.battlefield || []).some((entry: any) => {
      if (String(entry?.id || '').trim() !== resolvedTargetPermanentId) return false;
      return /\bcreature\b/i.test(String(entry?.card?.type_line || entry?.type_line || ''));
    }),
  );

  const optionalTriggerAccepted = (params.triggerItem as any)?.optionalTriggeredAbilityDecisionApplied === true;
  if (optionalTriggerAccepted) {
    recordDoThisOnlyOnceEachTurnOnAccept(state, params.triggerItem);
  }
  const createdTokenIds = Array.isArray(params.triggerItem?.effectData?.createdTokenIds)
    ? params.triggerItem.effectData.createdTokenIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : [];
  const lastAntecedentFromItem = Array.from(new Set([
    ...(Array.isArray(params.triggerItem?.lastAntecedentBattlefieldPermanentIds)
      ? params.triggerItem.lastAntecedentBattlefieldPermanentIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : []),
    ...(Array.isArray(params.triggerItem?.effectData?.lastAntecedentBattlefieldPermanentIds)
      ? params.triggerItem.effectData.lastAntecedentBattlefieldPermanentIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : []),
    ...(String(params.triggerItem?.effectData?.attackingCreatureId || '').trim()
      ? [String(params.triggerItem.effectData.attackingCreatureId).trim()]
      : []),
  ]));
  const lastAntecedentBattlefieldPermanentIds = createdTokenIds.length > 0
    ? createdTokenIds
    : lastAntecedentFromItem;
  const wasKicked = (params.triggerItem as any)?.wasKicked === true
    || (params.triggerItem as any)?.card?.wasKicked === true
    || (params.triggerItem as any)?.stackItem?.wasKicked === true
    || (params.triggerItem as any)?.sourceItem?.wasKicked === true;
  const triggeringSpell = params.triggerItem?.effectData?.triggeringSpell
    || params.triggerItem?.triggeringSpell;
  const triggeringSpellTypeLine = String(
    triggeringSpell?.type_line
    || triggeringSpell?.card?.type_line
    || (binding.targetSpellId
      ? (state?.stack || []).find((item: any) => String(item?.id || '').trim() === String(binding.targetSpellId))?.card?.type_line
      : '')
    || '',
  ).trim();
  const boundStackSpell = binding.targetSpellId
    ? (state?.stack || []).find((item: any) => String(item?.id || '').trim() === String(binding.targetSpellId))
    : undefined;
  const spentToCast = Number(boundStackSpell?.manaSpentTotal ?? boundStackSpell?.card?.manaSpentTotal);
  const noManaSpentToCast = Number.isFinite(spentToCast)
    ? spentToCast === 0
    : ((boundStackSpell?.castWithoutPayingManaCost === true
      || boundStackSpell?.card?.castWithoutPayingManaCost === true)
      ? true
      : undefined);
  const irCtx = buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: binding.sourcePermanentId || binding.sourceId,
      sourceName: params.sourceName,
      sourceObjectType: 'ability',
      xValue: binding.xValue,
      ...(enteredFromZone ? { enteredFromZone } : {}),
      ...(castFromZone ? { castFromZone } : {}),
      ...(wasKicked ? { wasKicked: true } : {}),
      ...(typeof binding.referenceAmount === 'number' ? { referenceAmount: binding.referenceAmount } : {}),
      ...(attackingPlayerId ? { attackingPlayerId } : {}),
      ...(createdTokenIds.length > 0
        ? {
            lastCreatedTokenIds: createdTokenIds,
            lastMovedBattlefieldPermanentIds: createdTokenIds,
          }
        : {}),
      ...(lastAntecedentBattlefieldPermanentIds.length > 0
        ? { lastAntecedentBattlefieldPermanentIds }
        : {}),
      ...(typeof noManaSpentToCast === 'boolean' ? { noManaSpentToCast } : {}),
      ...(sacrificedSnapshotsFromTriggerItem(params.triggerItem).length > 0
        ? { lastSacrificedPermanents: sacrificedSnapshotsFromTriggerItem(params.triggerItem) }
        : {}),
      selectorContext: {
        ...(binding.chosenObjectIds ? { chosenObjectIds: binding.chosenObjectIds } : {}),
        ...(binding.targetPlayerId ? { targetPlayerId: binding.targetPlayerId } : {}),
        ...(defendingOpponentId ? { targetOpponentId: defendingOpponentId } : {}),
        ...(binding.targetSpellId ? { targetSpellId: binding.targetSpellId } : {}),
        ...(typeof noManaSpentToCast === 'boolean' ? { noManaSpentToCast } : {}),
        ...(resolvedTargetPermanentId ? { targetPermanentId: resolvedTargetPermanentId } : {}),
        ...(resolvedTargetIsCreature ? { targetCreatureId: resolvedTargetPermanentId } : {}),
        ...(chosenCreatureType ? { chosenCreatureType } : {}),
        ...(lastAntecedentBattlefieldPermanentIds.length > 0
          ? { lastAntecedentBattlefieldPermanentIds }
          : {}),
        ...(attachedToId ? { attachedToId } : {}),
        ...(wasKicked ? { wasKicked: true } : {}),
        ...(enteredFromZone ? { enteredFromZone } : {}),
        ...(castFromZone ? { castFromZone } : {}),
      },
      ...(resolvedTargetPermanentId ? { targetPermanentId: resolvedTargetPermanentId } : {}),
      ...(resolvedTargetIsCreature ? { targetCreatureId: resolvedTargetPermanentId } : {}),
      ...(binding.targetSpellId ? { targetSpellId: binding.targetSpellId } : {}),
    },
    {
      targetPermanentId: resolvedTargetPermanentId || binding.targetPermanentId,
      ...(resolvedTargetIsCreature ? { targetCreatureId: resolvedTargetPermanentId } : {}),
      targetPlayerId: (attackingPlayerId || binding.targetPlayerId) as PlayerID | undefined,
      targetOpponentId: defendingOpponentId,
      targetSpellId: binding.targetSpellId,
      chosenObjectIds: binding.chosenObjectIds,
      sourceObjectType: 'ability',
      referenceAmount: binding.referenceAmount,
      ...(typeof binding.spellManaValue === 'number' ? { spellManaValue: binding.spellManaValue } : {}),
      ...(triggeringSpellTypeLine ? { spellType: triggeringSpellTypeLine } : {}),
      ...(enteredFromZone ? { enteredFromZone } : {}),
      ...(castFromZone ? { castFromZone } : {}),
      ...(chosenCreatureType ? { chosenCreatureType } : {}),
      ...(lastAntecedentBattlefieldPermanentIds.length > 0
        ? { lastAntecedentBattlefieldPermanentIds }
        : {}),
    },
  );
  if (optionalTriggerAccepted) {
    return { ...irCtx, optionalOfferAccepted: true } as typeof irCtx;
  }
  return irCtx;
}

function probeOracleIrTriggerShadow(
  ctx: GameContext,
  params: TryResolveTriggerViaOracleIRParams,
  steps: readonly OracleEffectStep[],
): OracleIRExecutionResult | null {
  if (steps.length === 0) return null;

  try {
    const shadowCtx = buildShadowProbeContext(ctx);
    const state = structuredClone((shadowCtx as any).state);
    hydrateOracleIRPlayerZonesFromContext(shadowCtx, state);
    const binding = resolveTriggerTargetBinding(shadowCtx, params.triggerItem, params.controller);
    const irCtx = buildTriggerIrContext(params, binding, state);
    const adjustedSteps = applyMillReplacementEffectsToSteps(
      shadowCtx,
      [...steps],
      params.controller,
      binding.targetPlayerId,
      state,
      irCtx,
    );

    return applyOracleIRStepsToGameState(state, adjustedSteps, withCurrentPowerToughnessHook({
      ...irCtx,
      interactivePlayerChoices: true,
    }), {
      allowOptional: true,
      selectedModeIds: buildTriggerExecutionOptionsFromSteps(steps, params.triggerItem).selectedModeIds,
      haltOnPlayerChoiceRequired: true,
    });
  } catch (err) {
    debugWarn(1, `[oracleIR-shadow] Trigger probe failed for ${params.sourceName}:`, err);
    return null;
  }
}

function libraryCountForPlayer(ctx: GameContext, controller: PlayerID): number {
  const fromMap = (ctx as any).libraries?.get?.(controller);
  if (Array.isArray(fromMap)) return fromMap.length;
  const player = ((ctx as any).state?.players || []).find(
    (entry: any) => String(entry?.id || '') === String(controller),
  );
  if (Array.isArray(player?.library)) return player.library.length;
  const zonesLibraryCount = (ctx as any).state?.zones?.[controller]?.libraryCount;
  if (typeof zonesLibraryCount === 'number') return zonesLibraryCount;
  return 0;
}

function drawEffectSynced(
  ctx: GameContext,
  controller: PlayerID,
  effectText: string,
  libraryCountBefore: number,
  queueBridged: boolean,
  result?: OracleIRExecutionResult,
): boolean {
  const normalized = String(effectText || '').replace(/\u2019/g, "'").trim();
  const hasDeferredDraw = /draw (?:a card|\d+ cards?)/i.test(normalized);
  const voteScaledDraw =
    /draw (?:a card|\d+ cards?) for each \w[\w' -]* vote/i.test(normalized)
    || (result?.pendingContinuationSteps || []).some((step) => {
      if (step.kind !== 'draw') return false;
      const amountKind = String((step as any)?.amount?.kind || '');
      return amountKind === 'votes_for_choice' || amountKind === 'votes_received';
    });
  if (voteScaledDraw && (queueBridged || (result?.pendingContinuationSteps || []).some((step) => step.kind === 'draw'))) {
    return true;
  }
  if (
    queueBridged
    && /you may put a land card from your hand onto the battlefield/i.test(normalized)
    && /if you don'?t,?\s*draw (?:a card|\d+ cards?)/i.test(normalized)
  ) {
    // Draw is deferred to KYNAIOS_CHOICE resolution, not applied during IR execution.
    return true;
  }

  const hasScrySurveilCompound =
    /(?:scry|surveil)\s+\d+/i.test(normalized) && hasDeferredDraw;
  if (hasScrySurveilCompound) {
    if (queueBridged) {
      // Draw resumes via oracleIrResumeStepsJson after SCRY/SURVEIL resolution.
      return true;
    }
    const pendingDraw = (result?.pendingContinuationSteps || []).some(
      (step) => String(step.kind || '') === 'draw',
    );
    const scrySurveilDeferred = (result?.skippedSteps || []).some(
      (step) => step.kind === 'scry' || step.kind === 'surveil',
    );
    if (pendingDraw && scrySurveilDeferred) {
      return true;
    }
  }

  if (!hasDeferredDraw) {
    return true;
  }

  const drawStepApplied = (result?.appliedSteps || []).some((step) => step.kind === 'draw');
  const drawStepPending = (result?.pendingContinuationSteps || []).some((step) => step.kind === 'draw');
  const chooseModeApplied = (result?.appliedSteps || []).some((step) => step.kind === 'choose_mode');
  if (chooseModeApplied && !drawStepApplied && !drawStepPending) {
    // Modal selected a branch without draw (e.g. gain life); oracle text still mentions draw.
    return true;
  }

  if (!drawStepApplied && !drawStepPending) {
    return true;
  }

  const drawMatch = normalized.match(/draw (?:a card|(\d+) cards?)/i);
  const expectedDrawn = drawMatch?.[1] ? parseInt(drawMatch[1], 10) : 1;
  if (!Number.isFinite(expectedDrawn) || expectedDrawn <= 0) {
    return true;
  }
  const libraryCountAfter = libraryCountForPlayer(ctx, controller);
  return libraryCountAfter <= libraryCountBefore - expectedDrawn;
}

export function tryResolveTriggerViaOracleIR(
  ctx: GameContext,
  params: TryResolveTriggerViaOracleIRParams,
): TryResolveTriggerViaOracleIRResult {
  const effectText = normalizeTriggerEffectDescriptionForExecution(String(params.effectText || ''));
  if (!effectText) {
    return { handled: false, applied: 0, shadowWouldHandle: false };
  }

  const steps = collectTriggerExecutionSteps(effectText, params.sourceName, params.triggerItem);
  if (steps.length === 0 || steps.every((step) => step.kind === 'unknown')) {
    return { handled: false, applied: 0, shadowWouldHandle: false };
  }

  const primary = isOracleIrTriggerPrimaryEnabled();
  const state = (ctx as any).state;
  const binding = resolveTriggerTargetBinding(ctx, params.triggerItem, params.controller);

  if (primary && isJoinForcesTriggerEffect(params.triggerItem, effectText)) {
    const queued = queueJoinForcesResolutionSteps(ctx, {
      controller: params.controller,
      cardName: params.sourceName,
      sourceId: binding.sourceId,
      sourceName: params.sourceName,
      sourceImage: params.sourceImage,
      effectDescription: String(params.effectText || effectText),
      cardImageUrl: params.triggerItem?.value?.imageUrl || params.triggerItem?.card?.image_uris?.small,
      logPrefix: 'oracleIR trigger',
    });
    if (queued) {
      return { handled: true, applied: 0, shadowWouldHandle: false };
    }
  }

  const irCtx = buildTriggerIrContext(params, binding, state);
  const executionOptions = buildTriggerExecutionOptionsFromSteps(steps, params.triggerItem);
  const normalizedSelectedModeIds = executionOptions.selectedModeIds;

  const useEffectProgram = requiresTriggerEffectProgramOrchestration(steps, normalizedSelectedModeIds);
  const hasChooseModeStep = steps.some((step) => step.kind === 'choose_mode');
  const hasPreselectedModes = Array.isArray(normalizedSelectedModeIds) && normalizedSelectedModeIds.length > 0;
  const canApplyPreselectedChooseMode = hasChooseModeStep && hasPreselectedModes;
  const effectProgramParams = {
    controller: params.controller,
    sourceName: params.sourceName,
    sourceId: binding.sourceId,
    sourceImage: params.sourceImage,
    steps,
    irCtx,
    executionOptions,
    programIdPrefix: `trigger:${binding.sourceId || params.sourceName}`,
    metadata: {
      family: 'trigger_resolution',
      triggerItem: params.triggerItem,
    },
  };

  if (!primary) {
    const effectProgramShadowWouldHandle = useEffectProgram
      ? probeOracleEffectProgramShadow(ctx, effectProgramParams)
      : false;
    let directShadowWouldHandle = false;
    if (!useEffectProgram) {
      const shadowResult = probeOracleIrTriggerShadow(ctx, params, steps);
      directShadowWouldHandle = shadowResult
        ? isOracleIrExecutionHandled(shadowResult, 0, 0)
        : false;
    }
    const shadowWouldHandle = directShadowWouldHandle || effectProgramShadowWouldHandle;

    if (shadowWouldHandle) {
      debug(
        2,
        `[oracleIR-shadow] ${params.sourceName}: ${useEffectProgram ? 'Effect Program' : 'direct IR'} trigger would handle`,
      );
    }

    return { handled: false, applied: 0, shadowWouldHandle };
  }

  if (useEffectProgram) {
    if (
      (ctx as any).isReplaying
      && isTriggerEffectOwnedByOracleIrPrimary(effectText, params.sourceName)
    ) {
      return { handled: true, applied: 0, shadowWouldHandle: false };
    }
    const effectProgramResult = startOracleEffectProgramOnServer(ctx, effectProgramParams);
    if (effectProgramResult.handled) {
      if (effectProgramResult.waitingForChoice && !effectProgramResult.completed) {
        // Choice is queued on the resolution queue — do not fall through to legacy handlers.
        return { handled: true, applied: 0, shadowWouldHandle: false };
      }
      return {
        handled: true,
        applied: effectProgramResult.completed ? 1 : 0,
        shadowWouldHandle: false,
      };
    }
  }

  if (!isTriggerEffectOwnedByOracleIrPrimary(effectText, params.sourceName) && !canApplyPreselectedChooseMode) {
    return { handled: false, applied: 0, shadowWouldHandle: false };
  }

  if (
    (ctx as any).isReplaying
    && (isTriggerEffectOwnedByOracleIrPrimary(effectText, params.sourceName) || canApplyPreselectedChooseMode)
  ) {
    // Mutations were persisted as executeEffect/oracle_ir_execution events during live play.
    return { handled: true, applied: 0, shadowWouldHandle: false };
  }

  try {
    const gameId = String((ctx as any).gameId || 'unknown');
    const queueBefore = gameId !== 'unknown'
      ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
      : 0;
    const libraryCountBefore = libraryCountForPlayer(ctx, params.controller);

    const result = applyOracleIRStepsOnServer(
      ctx,
      state,
      steps,
      irCtx,
      executionOptions,
      {
        controller: params.controller,
        targetPlayerId: binding.targetPlayerId,
        applyMillReplacements: true,
        triggerItem: params.triggerItem,
      },
    );

    const queueAfter = gameId !== 'unknown'
      ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
      : queueBefore;
    const queueBridged = queueAfter > queueBefore;
    const continuationBridged = isOracleIrContinuationBridged({
      state,
      gameId,
      resolutionQueueStepsBefore: queueBefore,
      resolutionQueueStepsAfter: queueAfter,
    });
    let handled = isOracleIrExecutionHandled(result, queueBefore, queueAfter, steps, state, gameId);
    const applied = result.appliedSteps.length;

    if (
      handled
      && !queueBridged
      && applied === 0
      && triggerCopyStepsNeedServerTargetQueue(steps)
    ) {
      handled = false;
    }

    if (
      handled
      && !queueBridged
      && applied > 0
      && String(params.triggerItem?.triggerType || '').toLowerCase() === 'annihilator'
      && steps.some((step) => step.kind === 'sacrifice')
    ) {
      handled = false;
    }

    if (
      handled
      && !continuationBridged
      && (result.pendingContinuationSteps || []).length > 0
    ) {
      handled = false;
    }

    if (
      handled
      && !continuationBridged
      && (result.pendingOptionalSteps || []).length > 0
      && applied > 0
    ) {
      handled = false;
    }

    if (
      handled
      && !continuationBridged
      && (result.automationGaps || []).some((gap) => gap.reasonCode === 'player_choice_required')
    ) {
      handled = false;
    }

    if (
      handled
      && !isTriggerEffectOwnedByOracleIrPrimary(effectText, params.sourceName)
      && !canApplyPreselectedChooseMode
    ) {
      handled = false;
    }

    if (handled && !drawEffectSynced(ctx, params.controller, effectText, libraryCountBefore, queueBridged, result)) {
      handled = false;
      logOracleIrAllOrNothingFailure(
        'trigger',
        params.sourceName,
        `Oracle IR reported handled but library did not decrease for draw effect: ${effectText}`,
        { applied, parsed: steps.length },
        { gameId: String((ctx as any)?.gameId || '') || undefined, effectText },
      );
    } else if (handled) {
      debug(
        2,
        `[oracleIR] Primary trigger resolution for ${params.sourceName}: ${applied} step(s) applied`,
      );
    } else {
      logOracleIrAllOrNothingFailure(
        'trigger',
        params.sourceName,
        describeOracleIrTriggerPrimaryIncomplete(
          effectText,
          params.sourceName,
          steps,
          result,
          queueBefore,
          queueAfter,
          {
            triggerType: params.triggerItem?.triggerType,
            canApplyPreselectedChooseMode,
            state,
            gameId,
          },
        ),
        { applied, parsed: steps.length },
        { gameId: String((ctx as any)?.gameId || '') || undefined, effectText },
      );
    }

    return { handled, applied, shadowWouldHandle: false };
  } catch (err) {
    debugWarn(1, `[oracleIR] Primary trigger resolution failed for ${params.sourceName}:`, err);
    return { handled: false, applied: 0, shadowWouldHandle: false };
  }
}
