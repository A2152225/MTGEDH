import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import {
  inferOracleIrTargetBinding,
  oracleIrTargetBindingToBaseContext,
  oracleIrTargetBindingToEventHint,
} from '../../../../rules-engine/src/oracleIrTargetBinding.js';
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
  requiresSpellEffectProgramOrchestration,
  startOracleEffectProgramOnServer,
} from './oracleIrEffectProgramServer.js';
import {
  collectSpellResolutionEffectSteps,
  type CollectOracleEffectStepsOptions,
} from './trigger-runtime-wiring.js';
import { extractOracleCardLookupKeys } from './oracleIrCompiledOverlayLookup.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { normalizeOracleIrSelectedModeIds } from './oracleIrModeSelection.js';
import { isOracleIrSpellPrimaryEnabled } from './oracleIrFeatureFlags.js';
import { isSpellEffectOwnedByOracleIrPrimary } from './oracleIrSpellLegacyRouting.js';
import { applyInstantSorceryGraveyardConditionalTokenRider } from './stackResolveSpellPostCategorizeRidersUtils.js';

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
  readonly card?: any;
  readonly effectiveCard?: any;
  readonly cardId?: string;
}

export interface TryResolveSpellViaOracleIRResult {
  readonly handled: boolean;
  readonly applied: number;
  readonly shadowWouldHandle: boolean;
  readonly legacySpellSpecOp?: string;
}

function collectSpellSteps(
  oracleText: string,
  sourceName: string,
  options?: CollectOracleEffectStepsOptions,
): OracleEffectStep[] {
  return collectSpellResolutionEffectSteps(oracleText, sourceName, options);
}

/** Map COLOR_CHOICE words / letters to EP/executor `chosenMana` symbols. */
function chosenColorToChosenMana(raw: string | undefined): string | undefined {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return undefined;
  if (/^\{[WUBRG]\}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^[WUBRG]$/i.test(trimmed)) return `{${trimmed.toUpperCase()}}`;
  const colorNameToSymbol: Record<string, string> = {
    white: '{W}',
    blue: '{U}',
    black: '{B}',
    red: '{R}',
    green: '{G}',
  };
  return colorNameToSymbol[trimmed.toLowerCase()] || undefined;
}

function buildSpellIrContext(
  params: TryResolveSpellViaOracleIRParams,
  targetBinding: ReturnType<typeof inferOracleIrTargetBinding>,
) {
  const chosenMana = chosenColorToChosenMana(params.chosenColor);
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
      ...((params.sourceItem as any)?.wasKicked === true || (params.card as any)?.wasKicked === true || (params.effectiveCard as any)?.wasKicked === true
        ? { wasKicked: true }
        : {}),
      ...(params.castFromGraveyard ? { castFromZone: 'graveyard' } : {}),
      ...oracleIrTargetBindingToBaseContext(targetBinding),
      selectorContext: {
        ...oracleIrTargetBindingToBaseContext(targetBinding).selectorContext,
        ...(params.chosenColor ? { chosenColor: params.chosenColor } : {}),
        ...(chosenMana ? { chosenMana } : {}),
        ...(params.chosenCreatureType ? { chosenCreatureType: params.chosenCreatureType } : {}),
      },
    },
    {
      ...oracleIrTargetBindingToEventHint(targetBinding),
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
  state?: any,
): boolean {
  const queueBridged = resolutionQueueStepsAfter > resolutionQueueStepsBefore;
  if (hasUnqueuedPlayerChoiceGap(result, queueBridged, state)) return false;

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
      state,
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
    const targetBinding = inferOracleIrTargetBinding(state, params.targets || [], params.controller);
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
}

export function tryResolveSpellViaOracleIR(
  ctx: GameContext,
  params: TryResolveSpellViaOracleIRParams,
): TryResolveSpellViaOracleIRResult {
  const cardKeys = extractOracleCardLookupKeys({
    cardId: params.cardId,
    cardName: params.spellName,
    sourceName: params.spellName,
    card: params.card,
    effectiveCard: params.effectiveCard,
    sourceItem: params.sourceItem,
  });
  const steps = collectSpellSteps(params.oracleText, params.spellName, cardKeys);
  if (steps.length === 0) {
    return { handled: false, applied: 0, shadowWouldHandle: false };
  }

  const normalizedSelectedModeIds = normalizeOracleIrSelectedModeIds(steps, params.selectedModeIds);
  const primary = isOracleIrSpellPrimaryEnabled();
  const state = (ctx as any).state;
  const targetBinding = inferOracleIrTargetBinding(state, params.targets || [], params.controller);
  const irCtx = buildSpellIrContext(params, targetBinding);
  const executionOptions = {
    allowOptional: true,
    selectedModeIds: normalizedSelectedModeIds,
  };

  const useEffectProgram = requiresSpellEffectProgramOrchestration(steps, normalizedSelectedModeIds);
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
    if (
      (ctx as any).isReplaying
      && isSpellEffectOwnedByOracleIrPrimary(params.oracleText, params.spellName)
    ) {
      return { handled: true, applied: 0, shadowWouldHandle: false };
    }
    const effectProgramResult = startOracleEffectProgramOnServer(ctx, effectProgramParams);
    if (effectProgramResult.handled) {
      if (effectProgramResult.waitingForChoice && !effectProgramResult.completed) {
        applyOracleIrSpellStructuralSupplements(ctx, params);
        // Choice is queued on the resolution queue — do not fall through to legacy handlers.
        return { handled: true, applied: 0, shadowWouldHandle: false };
      }
      applyOracleIrSpellStructuralSupplements(ctx, params);
      return {
        handled: true,
        applied: effectProgramResult.completed ? 1 : 0,
        shadowWouldHandle: false,
      };
    }
  }

  if (
    (ctx as any).isReplaying
    && isSpellEffectOwnedByOracleIrPrimary(params.oracleText, params.spellName)
  ) {
    return { handled: true, applied: 0, shadowWouldHandle: false };
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
        sourceItem: params.sourceItem,
        oracleText: params.oracleText,
      },
    );

    const queueAfter = gameId !== 'unknown'
      ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
      : queueBefore;
    const handled = isOracleIrExecutionHandled(result, queueBefore, queueAfter, steps, state);
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
        describeOracleIrExecutionHandledIncomplete(result, queueBefore, queueAfter, steps, state),
        { applied, parsed: steps.length },
        {
          gameId: gameId !== 'unknown' ? gameId : undefined,
          effectText: params.oracleText,
        },
      );
    }

    return { handled, applied, shadowWouldHandle: false };
  } catch (err) {
    debugWarn(1, `[oracleIR] Primary spell resolution failed for ${params.spellName}:`, err);
    applyOracleIrSpellStructuralSupplements(ctx, params);
    return { handled: false, applied: 0, shadowWouldHandle: false };
  }
}
