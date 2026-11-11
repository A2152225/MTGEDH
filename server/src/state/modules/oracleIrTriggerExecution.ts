import { recordDilemmaFaced } from './triggers/trekPlayerEventTriggers.js';
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
import { withCurrentPowerToughnessHook } from './currentPowerToughness.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { isOracleIrTriggerPrimaryEnabled } from './oracleIrFeatureFlags.js';
import { isTriggerEffectOwnedByOracleIrPrimary } from './oracleIrTriggerLegacyRouting.js';
import {
  isJoinForcesTriggerEffect,
  queueJoinForcesResolutionSteps,
} from './joinForcesResolutionQueue.js';
import { normalizeTriggerEffectDescriptionForExecution } from './trigger-runtime-wiring.js';
import { resolveTriggerTargetBinding } from './oracleIrTriggerTargetBinding.js';

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
  const interveningSubjectForPronoun = String(
    params.triggerItem?.interveningIfSubjectPermanentId || '',
  ).trim();
  const effectForPronoun = String(params.triggerItem?.effect || params.triggerItem?.description || '');
  // "it deals damage equal to its power" / "equal to that creature's power":
  // the pronoun is the permanent that entered, not the chosen damage target.
  const pronounIsEnteringObject = /^(?:it|that creature|that permanent)\b/i.test(effectForPronoun)
    || /\bequal to that creature's (?:power|toughness)\b/i.test(effectForPronoun);
  const lastAntecedentBattlefieldPermanentIds = createdTokenIds.length > 0
    ? createdTokenIds
    : lastAntecedentFromItem.length > 0
      ? lastAntecedentFromItem
      : (pronounIsEnteringObject && interveningSubjectForPronoun ? [interveningSubjectForPronoun] : []);
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
  // FACE A DILEMMA for a modal triggered ability (recorded once per trigger).
  if (canApplyPreselectedChooseMode && params.triggerItem && !(params.triggerItem as any).dilemmaRecorded) {
    (params.triggerItem as any).dilemmaRecorded = true;
    recordDilemmaFaced(ctx, String(params.controller || ''), normalizedSelectedModeIds!.length);
  }
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
      && !queueBridged
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
