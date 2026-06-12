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
import {
  describeOracleIrExecutionHandledIncomplete,
  logOracleIrAllOrNothingFailure,
} from './oracleIrStepWiring.js';
import { isOracleIrExecutionHandled } from './oracleIrSpellExecution.js';
import {
  buildTriggerExecutionOptionsFromSteps,
  collectTriggerExecutionSteps,
} from './oracleIrTriggerExecutionHelpers.js';
import {
  probeOracleEffectProgramShadow,
  requiresEffectProgramOrchestration,
  startOracleEffectProgramOnServer,
} from './oracleIrEffectProgramServer.js';
import { copyPermanentTriggerStepNeedsTargetSelectionQueue } from './trigger-copy-permanent.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { isOracleIrTriggerPrimaryEnabled } from './oracleIrFeatureFlags.js';
import { isTriggerEffectOwnedByOracleIrPrimary } from './oracleIrTriggerLegacyRouting.js';
import { normalizeTriggerEffectDescriptionForExecution } from './trigger-runtime-wiring.js';

export { isOracleIrTriggerPrimaryEnabled } from './oracleIrFeatureFlags.js';

function triggerCopyStepsNeedServerTargetQueue(steps: readonly OracleEffectStep[]): boolean {
  return steps.some(
    (step) => step.kind === 'copy_permanent'
      && copyPermanentTriggerStepNeedsTargetSelectionQueue(
        step as Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
      ),
  );
}

function describeOracleIrTriggerPrimaryIncomplete(
  effectText: string,
  sourceName: string,
  steps: readonly OracleEffectStep[],
  result: OracleIRExecutionResult,
  queueBefore: number,
  queueAfter: number,
  options: {
    triggerType?: string;
    canApplyPreselectedChooseMode: boolean;
  },
): readonly string[] {
  const reasons = [
    ...describeOracleIrExecutionHandledIncomplete(result, queueBefore, queueAfter, steps),
  ];
  const applied = result.appliedSteps.length;
  const pendingOptional = (result.pendingOptionalSteps || []).length;
  const pendingContinuation = (result.pendingContinuationSteps || []).length;
  const queueBridged = queueAfter > queueBefore;

  if (
    !queueBridged
    && applied === 0
    && triggerCopyStepsNeedServerTargetQueue(steps)
  ) {
    reasons.push('copy_permanent_needs_server_target_queue');
  }

  if (
    !queueBridged
    && applied > 0
    && String(options.triggerType || '').toLowerCase() === 'annihilator'
    && steps.some((step) => step.kind === 'sacrifice')
  ) {
    reasons.push('annihilator_sacrifice_requires_resolution_queue_bridge');
  }

  if (
    !queueBridged
    && pendingOptional > 0
    && applied > 0
  ) {
    reasons.push(
      `pending_optional_without_queue_bridge: ${pendingOptional} optional step(s) remain`,
    );
  }

  if (
    !queueBridged
    && pendingContinuation > 0
    && !reasons.some((reason) => reason.startsWith('pending_continuation_without_queue_bridge'))
  ) {
    const kinds = (result.pendingContinuationSteps || [])
      .map((step) => String(step.kind || 'unknown'))
      .join(', ');
    reasons.push(
      `pending_continuation_without_queue_bridge: ${pendingContinuation} step(s) [${kinds}]`,
    );
  }

  if (
    !isTriggerEffectOwnedByOracleIrPrimary(effectText, sourceName)
    && !options.canApplyPreselectedChooseMode
  ) {
    reasons.push('effect_not_primary_owned_by_oracle_ir');
  }

  return reasons;
}

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
} {
  const state = (ctx as any).state;
  const targets = Array.isArray(triggerItem?.targets) ? triggerItem.targets : [];
  let targetPlayerId = String(
    targets[0]?.id || targets[0] || triggerItem?.targetPlayerId || '',
  ).trim() as PlayerID;

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
    const defendingPlayerId = String(triggerItem?.defendingPlayer || '').trim();
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
    targetSpellId = triggeringStackItemId;
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

  return {
    targetPermanentId,
    targetPlayerId: (targetPlayerId || losingPlayerId || undefined) as PlayerID | undefined,
    targetSpellId,
    chosenObjectIds: normalizedTargetIds.length > 0 ? normalizedTargetIds : undefined,
    sourcePermanentId: sourcePermanentId || undefined,
    sourceId: sourceId || undefined,
    referenceAmount: Number.isFinite(lifeLostReference) && lifeLostReference > 0 ? lifeLostReference : undefined,
    xValue: typeof triggerItem?.xValue === 'number' ? triggerItem.xValue : undefined,
  };
}

function buildTriggerIrContext(
  params: TryResolveTriggerViaOracleIRParams,
  binding: ReturnType<typeof resolveTriggerTargetBinding>,
) {
  const selectedModeIds = Array.isArray(params.triggerItem?.selectedModeIds)
    ? params.triggerItem.selectedModeIds
    : Array.isArray(params.triggerItem?.selectedModes)
      ? params.triggerItem.selectedModes
      : undefined;

  const defendingOpponentId = binding.targetPlayerId && String(binding.targetPlayerId) !== String(params.controller)
    ? binding.targetPlayerId
    : undefined;
  const chosenCreatureType = String(
    params.triggerItem?.chosenCreatureType
    || params.triggerItem?.card?.chosenCreatureType
    || '',
  ).trim();

  return buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: binding.sourcePermanentId || binding.sourceId,
      sourceName: params.sourceName,
      sourceObjectType: 'ability',
      xValue: binding.xValue,
      ...(typeof binding.referenceAmount === 'number' ? { referenceAmount: binding.referenceAmount } : {}),
      selectorContext: {
        ...(binding.chosenObjectIds ? { chosenObjectIds: binding.chosenObjectIds } : {}),
        ...(binding.targetPlayerId ? { targetPlayerId: binding.targetPlayerId } : {}),
        ...(defendingOpponentId ? { targetOpponentId: defendingOpponentId } : {}),
        ...(binding.targetSpellId ? { targetSpellId: binding.targetSpellId } : {}),
        ...(chosenCreatureType ? { chosenCreatureType } : {}),
      },
      ...(binding.targetPermanentId ? { targetPermanentId: binding.targetPermanentId } : {}),
      ...(binding.targetSpellId ? { targetSpellId: binding.targetSpellId } : {}),
    },
    {
      targetPermanentId: binding.targetPermanentId,
      targetPlayerId: binding.targetPlayerId,
      targetOpponentId: defendingOpponentId,
      targetSpellId: binding.targetSpellId,
      chosenObjectIds: binding.chosenObjectIds,
      sourceObjectType: 'ability',
      referenceAmount: binding.referenceAmount,
      ...(chosenCreatureType ? { chosenCreatureType } : {}),
    },
  );
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
    const irCtx = buildTriggerIrContext(params, binding);
    const adjustedSteps = applyMillReplacementEffectsToSteps(
      shadowCtx,
      [...steps],
      params.controller,
      binding.targetPlayerId,
      state,
      irCtx,
    );

    return applyOracleIRStepsToGameState(state, adjustedSteps, {
      ...irCtx,
      interactivePlayerChoices: true,
    }, {
      allowOptional: true,
      selectedModeIds: buildTriggerExecutionOptionsFromSteps(steps, params.triggerItem).selectedModeIds,
      haltOnPlayerChoiceRequired: true,
    });
  } catch (err) {
    debugWarn(1, `[oracleIR-shadow] Trigger probe failed for ${params.sourceName}:`, err);
    return null;
  }
}

export function tryResolveTriggerViaOracleIR(
  ctx: GameContext,
  params: TryResolveTriggerViaOracleIRParams,
): TryResolveTriggerViaOracleIRResult {
  const effectText = normalizeTriggerEffectDescriptionForExecution(String(params.effectText || ''));
  if (!effectText) {
    return { handled: false, applied: 0, shadowWouldHandle: false };
  }

  const steps = collectTriggerExecutionSteps(effectText, params.sourceName);
  if (steps.length === 0 || steps.every((step) => step.kind === 'unknown')) {
    return { handled: false, applied: 0, shadowWouldHandle: false };
  }

  const primary = isOracleIrTriggerPrimaryEnabled();
  const state = (ctx as any).state;
  const binding = resolveTriggerTargetBinding(ctx, params.triggerItem, params.controller);
  const irCtx = buildTriggerIrContext(params, binding);
  const executionOptions = buildTriggerExecutionOptionsFromSteps(steps, params.triggerItem);
  const normalizedSelectedModeIds = executionOptions.selectedModeIds;

  const useEffectProgram = requiresEffectProgramOrchestration(steps, normalizedSelectedModeIds);
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
    const effectProgramResult = startOracleEffectProgramOnServer(ctx, effectProgramParams);
    if (effectProgramResult.handled) {
      if (effectProgramResult.waitingForChoice && !effectProgramResult.completed) {
        return { handled: false, applied: 0, shadowWouldHandle: false };
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

  try {
    const gameId = String((ctx as any).gameId || 'unknown');
    const queueBefore = gameId !== 'unknown'
      ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
      : 0;

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
    let handled = isOracleIrExecutionHandled(result, queueBefore, queueAfter, steps);
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
      && !queueBridged
      && (result.pendingContinuationSteps || []).length > 0
    ) {
      handled = false;
    }

    if (
      handled
      && !queueBridged
      && (result.pendingOptionalSteps || []).length > 0
      && applied > 0
    ) {
      handled = false;
    }

    if (
      handled
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

    if (handled) {
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
          },
        ),
        { applied, parsed: steps.length },
      );
    }

    return { handled, applied, shadowWouldHandle: false };
  } catch (err) {
    debugWarn(1, `[oracleIR] Primary trigger resolution failed for ${params.sourceName}:`, err);
    return { handled: false, applied: 0, shadowWouldHandle: false };
  }
}
