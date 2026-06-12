import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import {
  applyOracleIRStepsToGameState,
  buildOracleIRExecutionContext,
  type OracleIRExecutionResult,
} from '../../../../rules-engine/src/oracleIRExecutor.js';
import {
  describeOracleIrExecutionHandledIncomplete,
  hasUnqueuedPlayerChoiceGap,
  isOracleIrMandatoryExecutionComplete,
  logOracleIrAllOrNothingFailure,
} from './oracleIrStepWiring.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import {
  applyMillReplacementEffectsToSteps,
  applyOracleIRStepsOnServer,
  buildShadowProbeContext,
  hydrateOracleIRPlayerZonesFromContext,
} from './oracleIrServerZoneSync.js';
import {
  probeOracleEffectProgramShadow,
  requiresEffectProgramOrchestration,
  startOracleEffectProgramOnServer,
} from './oracleIrEffectProgramServer.js';
import { collectOracleEffectSteps } from './trigger-runtime-wiring.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { normalizeOracleIrSelectedModeIds } from './oracleIrModeSelection.js';
import { isOracleIrSpellPrimaryEnabled } from './oracleIrFeatureFlags.js';
import { applyInstantSorceryGraveyardConditionalTokenRider } from './stackResolveSpellPostCategorizeRidersUtils.js';
import { detectInstantSorcerySpellShapeFlags } from './oracleIrSpellLegacySpellShapeUtils.js';
import { applyInstantSorceryNibelheimAflameEffect } from './stackResolveSpellSpecialCaseUtils.js';

export { isOracleIrSpellPrimaryEnabled } from './oracleIrFeatureFlags.js';

export interface TryResolveSpellViaOracleIRParams {
  readonly controller: PlayerID;
  readonly spellName: string;
  readonly oracleText: string;
  readonly sourceId?: string;
  readonly sourcePermanentId?: string;
  readonly targets?: readonly string[];
  readonly xValue?: number;
  readonly selectedModeIds?: readonly string[];
  readonly castFromGraveyard?: boolean;
  readonly giftPromised?: boolean;
  readonly teamworkWasPaid?: boolean;
  readonly chosenColor?: string;
  readonly chosenCreatureType?: string;
  readonly sourceColors?: readonly string[];
  readonly sourceImage?: string;
  readonly sourceItem?: any;
}

export interface TryResolveSpellViaOracleIRResult {
  readonly handled: boolean;
  readonly applied: number;
  readonly shadowWouldHandle: boolean;
  readonly legacySpellSpecOp?: string;
}

function collectSpellSteps(oracleText: string, sourceName: string): OracleEffectStep[] {
  return collectOracleEffectSteps(oracleText, sourceName);
}

function inferTargetBinding(state: any, targetIds: readonly string[], controller?: PlayerID): {
  targetPermanentId?: string;
  targetPlayerId?: PlayerID;
  targetOpponentId?: PlayerID;
  targetSpellId?: string;
  chosenObjectIds?: readonly string[];
} {
  if (!Array.isArray(targetIds) || targetIds.length === 0) return {};
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const players = Array.isArray(state?.players) ? state.players : [];
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  const controllerId = String(controller || '').trim();

  for (const targetId of targetIds) {
    const id = String(targetId || '').trim();
    if (!id) continue;
    if (battlefield.some((permanent: any) => String(permanent?.id || '') === id)) {
      return { targetPermanentId: id, chosenObjectIds: targetIds };
    }
    if (players.some((player: any) => String(player?.id || '') === id)) {
      const isOpponent = Boolean(controllerId) && id !== controllerId;
      return {
        targetPlayerId: id as PlayerID,
        ...(isOpponent ? { targetOpponentId: id as PlayerID } : {}),
        chosenObjectIds: targetIds,
      };
    }
    if (stack.some((stackItem: any) => String(stackItem?.id || '') === id)) {
      return { targetSpellId: id, chosenObjectIds: targetIds };
    }
  }

  return { chosenObjectIds: targetIds };
}

function buildSpellIrContext(
  params: TryResolveSpellViaOracleIRParams,
  targetBinding: ReturnType<typeof inferTargetBinding>,
) {
  return buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: params.sourceId || params.sourcePermanentId,
      sourceName: params.spellName,
      sourceObjectType: 'spell',
      xValue: params.xValue,
      sourceColors: params.sourceColors,
      ...(typeof params.giftPromised === 'boolean' ? { giftPromised: params.giftPromised } : {}),
      ...(typeof params.teamworkWasPaid === 'boolean' ? { teamworkWasPaid: params.teamworkWasPaid } : {}),
      ...(params.castFromGraveyard ? { castFromZone: 'graveyard' } : {}),
      selectorContext: {
        ...(targetBinding.chosenObjectIds ? { chosenObjectIds: targetBinding.chosenObjectIds } : {}),
        ...(targetBinding.targetPlayerId ? { targetPlayerId: targetBinding.targetPlayerId } : {}),
        ...(targetBinding.targetOpponentId ? { targetOpponentId: targetBinding.targetOpponentId } : {}),
        ...(targetBinding.targetSpellId ? { targetSpellId: targetBinding.targetSpellId } : {}),
        ...(params.chosenColor ? { chosenColor: params.chosenColor } : {}),
        ...(params.chosenCreatureType ? { chosenCreatureType: params.chosenCreatureType } : {}),
      },
      ...(targetBinding.targetPermanentId ? { targetPermanentId: targetBinding.targetPermanentId } : {}),
    },
    {
      targetPermanentId: targetBinding.targetPermanentId,
      targetPlayerId: targetBinding.targetPlayerId,
      targetSpellId: targetBinding.targetSpellId,
      chosenObjectIds: targetBinding.chosenObjectIds,
      sourceObjectType: 'spell',
      sourceColors: params.sourceColors,
      castFromZone: params.castFromGraveyard ? 'graveyard' : undefined,
      chosenColor: params.chosenColor,
      chosenCreatureType: params.chosenCreatureType,
    },
  );
}

export function isOracleIrExecutionHandled(
  result: OracleIRExecutionResult,
  resolutionQueueStepsBefore: number,
  resolutionQueueStepsAfter: number,
  parsedSteps?: readonly OracleEffectStep[],
): boolean {
  const queueBridged = resolutionQueueStepsAfter > resolutionQueueStepsBefore;
  if (hasUnqueuedPlayerChoiceGap(result, queueBridged)) return false;

  const pendingContinuation = (result.pendingContinuationSteps || []).length;
  if (pendingContinuation > 0 && !queueBridged) return false;

  const applied = result.appliedSteps.length;
  const pendingOptional = (result.pendingOptionalSteps || []).length;
  const hasEffect =
    applied > 0
    || pendingOptional > 0
    || pendingContinuation > 0
    || queueBridged
    || (result.automationGaps || []).some((gap) => gap.classification === 'player_choice');

  if (!hasEffect) return false;

  if (parsedSteps && parsedSteps.length > 0) {
    return isOracleIrMandatoryExecutionComplete(parsedSteps, result, {
      resolutionQueueStepsBefore,
      resolutionQueueStepsAfter,
    });
  }

  return true;
}

function probeOracleIrSpellShadow(
  ctx: GameContext,
  params: TryResolveSpellViaOracleIRParams,
  steps: readonly OracleEffectStep[],
): OracleIRExecutionResult | null {
  if (steps.length === 0) return null;

  const normalizedSelectedModeIds = normalizeOracleIrSelectedModeIds(steps, params.selectedModeIds);

  try {
    const shadowCtx = buildShadowProbeContext(ctx);
    const state = structuredClone((shadowCtx as any).state);
    hydrateOracleIRPlayerZonesFromContext(shadowCtx, state);
    const targetBinding = inferTargetBinding(state, params.targets || [], params.controller);
    const irCtx = buildSpellIrContext(params, targetBinding);
    const adjustedSteps = applyMillReplacementEffectsToSteps(
      shadowCtx,
      [...steps],
      params.controller,
      targetBinding.targetPlayerId,
      state,
      irCtx,
    );

    return applyOracleIRStepsToGameState(state, adjustedSteps, {
      ...irCtx,
      interactivePlayerChoices: true,
    }, {
      allowOptional: true,
      selectedModeIds: normalizedSelectedModeIds,
      haltOnPlayerChoiceRequired: true,
    });
  } catch (err) {
    debugWarn(1, `[oracleIR-shadow] Probe failed for ${params.spellName}:`, err);
    return null;
  }
}

function applyOracleIrSpellStructuralSupplements(
  ctx: GameContext,
  params: TryResolveSpellViaOracleIRParams,
): void {
  const oracleTextLower = String(params.oracleText || '').toLowerCase();
  const shapeFlags = detectInstantSorcerySpellShapeFlags(params.spellName, oracleTextLower);
  const supplementItem = params.sourceItem || {
    castFromGraveyard: params.castFromGraveyard,
    card: {
      castFromGraveyard: params.castFromGraveyard,
      castWithAbility: params.castFromGraveyard ? 'flashback' : undefined,
    },
  };
  const supplementTargets = (Array.isArray(params.targets) && params.targets.length > 0
    ? params.targets
    : Array.isArray(supplementItem?.targets)
      ? supplementItem.targets
          .map((targetRef: any) => (typeof targetRef === 'string' ? targetRef : String(targetRef?.id || '')))
          .filter(Boolean)
      : []) as string[];

  applyInstantSorceryGraveyardConditionalTokenRider(ctx, {
    controller: params.controller,
    card: params.sourceItem?.card || { id: params.sourceId, name: params.spellName },
    effectiveCard: { name: params.spellName },
    item: supplementItem,
    oracleText: params.oracleText,
    oracleTextLower,
    targets: supplementTargets,
    spellXValue: params.xValue,
    uncategorizedSpellFallbackApplied: 0,
  });

  if (
    shapeFlags.isNibelheimAflameStyleSweep
    && supplementTargets.length > 0
  ) {
    applyInstantSorceryNibelheimAflameEffect(ctx, {
      controller: params.controller,
      effectiveCard: { name: params.spellName },
      item: supplementItem,
      targets: supplementTargets,
      isNibelheimAflameStyleSweep: true,
      hasNibelheimGraveyardRider: shapeFlags.hasNibelheimGraveyardRider,
    });
  }
}

export function tryResolveSpellViaOracleIR(
  ctx: GameContext,
  params: TryResolveSpellViaOracleIRParams,
): TryResolveSpellViaOracleIRResult {
  const steps = collectSpellSteps(params.oracleText, params.spellName);
  if (steps.length === 0) {
    return { handled: false, applied: 0, shadowWouldHandle: false };
  }

  const normalizedSelectedModeIds = normalizeOracleIrSelectedModeIds(steps, params.selectedModeIds);
  const primary = isOracleIrSpellPrimaryEnabled();
  const state = (ctx as any).state;
  const targetBinding = inferTargetBinding(state, params.targets || [], params.controller);
  const irCtx = buildSpellIrContext(params, targetBinding);
  const executionOptions = {
    allowOptional: true,
    selectedModeIds: normalizedSelectedModeIds,
  };

  const useEffectProgram = requiresEffectProgramOrchestration(steps, normalizedSelectedModeIds);
  const effectProgramParams = {
    controller: params.controller,
    sourceName: params.spellName,
    sourceId: params.sourceId,
    sourceImage: params.sourceImage,
    steps,
    irCtx,
    executionOptions,
    programIdPrefix: `spell:${params.sourceId || params.spellName}`,
    metadata: { family: 'spell_resolution' },
  };

  if (!primary) {
    const shadowResult = useEffectProgram
      ? null
      : probeOracleIrSpellShadow(ctx, params, steps);
    const directShadowWouldHandle = shadowResult
      ? isOracleIrExecutionHandled(shadowResult, 0, 0)
      : false;
    const effectProgramShadowWouldHandle = useEffectProgram
      ? probeOracleEffectProgramShadow(ctx, effectProgramParams)
      : false;
    const shadowWouldHandle = directShadowWouldHandle || effectProgramShadowWouldHandle;

    if (shadowWouldHandle) {
      debug(
        2,
        `[oracleIR-shadow] ${params.spellName}: ${useEffectProgram ? 'Effect Program' : 'direct IR'} would handle` +
          (directShadowWouldHandle
            ? ` (${shadowResult?.appliedSteps.length ?? 0} applied, ${shadowResult?.pendingContinuationSteps?.length ?? 0} continuation)`
            : ''),
      );
    }

    return {
      handled: false,
      applied: 0,
      shadowWouldHandle,
    };
  }

  if (useEffectProgram) {
    const effectProgramResult = startOracleEffectProgramOnServer(ctx, effectProgramParams);
    if (effectProgramResult.handled) {
      if (effectProgramResult.waitingForChoice && !effectProgramResult.completed) {
        applyOracleIrSpellStructuralSupplements(ctx, params);
        return { handled: false, applied: 0, shadowWouldHandle: false };
      }
      applyOracleIrSpellStructuralSupplements(ctx, params);
      return {
        handled: true,
        applied: effectProgramResult.completed ? 1 : 0,
        shadowWouldHandle: false,
      };
    }
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
        targetPlayerId: targetBinding.targetPlayerId,
        applyMillReplacements: true,
      },
    );

    const queueAfter = gameId !== 'unknown'
      ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
      : queueBefore;
    const handled = isOracleIrExecutionHandled(result, queueBefore, queueAfter, steps);
    const applied = result.appliedSteps.length;

    applyOracleIrSpellStructuralSupplements(ctx, params);

    if (handled) {
      debug(
        2,
        `[oracleIR] Primary spell resolution for ${params.spellName}: ${applied} step(s) applied` +
          ((result.pendingContinuationSteps?.length ?? 0) > 0
            ? `, ${result.pendingContinuationSteps!.length} pending continuation`
            : '') +
          ((result.pendingOptionalSteps?.length ?? 0) > 0
            ? `, ${result.pendingOptionalSteps!.length} optional pending`
            : ''),
      );
    } else {
      logOracleIrAllOrNothingFailure(
        'spell',
        params.spellName,
        describeOracleIrExecutionHandledIncomplete(result, queueBefore, queueAfter, steps),
        { applied, parsed: steps.length },
      );
    }

    return { handled, applied, shadowWouldHandle: false };
  } catch (err) {
    debugWarn(1, `[oracleIR] Primary spell resolution failed for ${params.spellName}:`, err);
    applyOracleIrSpellStructuralSupplements(ctx, params);
    return { handled: false, applied: 0, shadowWouldHandle: false };
  }
}
