// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerCopyPermanentMoveZonePrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: queueCopyPermanentChoicePromptsFromOracleIRResult,
//   queueMoveZoneChoicePromptsFromOracleIRResult, and
//   queueMoveZoneDestinationChoicePromptsFromOracleIRResult, plus the
//   move-zone helpers they close over.
// Public entry symbols: queueCopyPermanentChoicePromptsFromOracleIRResult,
//   queueMoveZoneChoicePromptsFromOracleIRResult,
//   queueMoveZoneDestinationChoicePromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { buildMoveZoneSelectionOptions } from '../../../../../rules-engine/src/oracleIRExecutorPlayerStepHandlers.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
  isOracleIrPlayerChoiceGap,
  normalizeTopLibraryPromptCard,
} from '../oracleIrServerPromptResumeUtils.js';
import {
  applyCopyPermanentTriggerStep,
  copyPermanentTriggerStepNeedsTargetSelectionQueue,
} from '../trigger-copy-permanent.js';
import {
  isBothPlayersMayPutPermanentFromHandStep,
  isControllerMayPutLandFromHandStep,
  isEachPlayerMayPutLandFromHandStep,
} from '../triggerLandPlayPromptUtils.js';

export function queueCopyPermanentChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  _state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourcePermanentId = String(params.sourceId || '').trim();
  if (!sourcePermanentId) return;

  const queuedKeys = new Set<string>();
  const candidates: OracleEffectStep[] = [];
  for (const step of result.skippedSteps || []) {
    if (step.kind === 'copy_permanent') candidates.push(step);
  }
  for (const step of result.pendingOptionalSteps || []) {
    if (step.kind === 'copy_permanent') candidates.push(step);
  }

  for (const step of candidates) {
    if (step.kind !== 'copy_permanent') continue;
    const copyStep = step as Extract<OracleEffectStep, { kind: 'copy_permanent' }>;
    if (!copyPermanentTriggerStepNeedsTargetSelectionQueue(copyStep)) continue;

    const queueKey = `copy_permanent:${String(copyStep.raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    applyCopyPermanentTriggerStep(
      ctx,
      params.controller,
      sourceName,
      copyStep,
      {
        source: sourcePermanentId,
        permanentId: sourcePermanentId,
        sourceId: sourcePermanentId,
      },
    );
  }
}

function buildMoveZoneLibrarySearchPrompt(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  built: NonNullable<ReturnType<typeof buildMoveZoneSelectionOptions>>,
  params: {
    controller: PlayerID;
    sourceName: string;
    sourceId?: string;
  },
): Record<string, unknown> {
  const availableCards = built.availableCards.map(normalizeTopLibraryPromptCard);
  const selectableIds = new Set(built.selectableCardIds);
  const nonSelectableCards = availableCards.filter(
    (card) => !selectableIds.has(String(card.id || '')),
  );

  return {
    type: ResolutionStepType.LIBRARY_SEARCH,
    playerId: built.playerId,
    description: `${params.sourceName}: ${String((step as any).raw || 'Choose cards')}`,
    mandatory: !built.optional,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    searchCriteria: String((step as any).raw || 'Choose cards to move'),
    minSelections: built.minSelections,
    maxSelections: built.maxSelections,
    destination: built.destination,
    reveal: false,
    shuffleAfter: built.shuffleAfter,
    remainderDestination: built.remainderDestination,
    remainderRandomOrder: built.remainderRandomOrder,
    remainderPlayerChoosesOrder: built.remainderPlayerChoosesOrder,
    availableCards,
    nonSelectableCards,
    filter: built.filter,
    searchZone: built.searchZone,
    persistLibrarySearchResolve: true,
    persistLibrarySearchResolveReason: 'stack_resolution',
    oracleIrChoiceStepJson: JSON.stringify([step]),
    oracleIrControllerId: params.controller,
    oracleIrSourceId: params.sourceId,
    oracleIrSourceName: params.sourceName,
  };
}

function collectMoveZoneChoiceSteps(
  result: OracleIRExecutionResult,
): Extract<OracleEffectStep, { kind: 'move_zone' }>[] {
  const steps: Extract<OracleEffectStep, { kind: 'move_zone' }>[] = [];
  const seen = new Set<string>();

  const isLandPlayFromHandStep = (
    step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ): boolean => isControllerMayPutLandFromHandStep(step)
    || isEachPlayerMayPutLandFromHandStep(step)
    || isBothPlayersMayPutPermanentFromHandStep(step);

  for (const gap of result.automationGaps || []) {
    if (String(gap.stepKind || '') !== 'move_zone') continue;
    if (!isOracleIrPlayerChoiceGap(gap)) {
      continue;
    }
    const destinationChoice = (gap.metadata as any)?.moveZoneDestinationChoice;
    if (Array.isArray(destinationChoice) && destinationChoice.length > 0) {
      // Handled by queueMoveZoneDestinationChoicePromptsFromOracleIRResult (OPTION_CHOICE).
      continue;
    }
    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'move_zone' }> | undefined;
    if (!step || isLandPlayFromHandStep(step)) continue;
    const key = `${String((step as any).raw || '')}:${String((step.what as any)?.text || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push(step);
  }

  for (const step of result.skippedSteps || []) {
    if (step.kind !== 'move_zone') continue;
    const moveStep = step as Extract<OracleEffectStep, { kind: 'move_zone' }>;
    const isDestinationChoiceGap = (result.automationGaps || []).some((gap) => {
      if (String(gap.stepKind || '') !== 'move_zone') return false;
      const destinations = (gap.metadata as any)?.moveZoneDestinationChoice;
      if (!Array.isArray(destinations) || destinations.length === 0) return false;
      return findSkippedOracleStep(result, gap) === moveStep;
    });
    if (isDestinationChoiceGap) continue;
    if (isLandPlayFromHandStep(moveStep)) continue;
    const key = `${String((moveStep as any).raw || '')}:${String((moveStep.what as any)?.text || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push(moveStep);
  }

  return steps;
}

export function queueMoveZoneChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const step of collectMoveZoneChoiceSteps(result)) {
    const built = buildMoveZoneSelectionOptions(state, step, params.irCtx);
    if (!built) continue;

    const queueKey = `move_zone:${String((step as any).raw || '')}:${String((step.what as any)?.text || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const prompt = buildMoveZoneLibrarySearchPrompt(step, built, {
      controller: params.controller,
      sourceName,
      sourceId,
    });
    ResolutionQueueManager.addStep(
      gameId,
      attachOracleIrResumeMetadata(prompt, result, params) as any,
    );
  }
}

export function queueMoveZoneDestinationChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();
  const priorChosenObjectIds = [
    ...(Array.isArray(params.irCtx.selectorContext?.chosenObjectIds)
      ? params.irCtx.selectorContext!.chosenObjectIds
      : []),
    ...(Array.isArray((params.irCtx as any).chosenObjectIds)
      ? (params.irCtx as any).chosenObjectIds
      : []),
  ]
    .map((id) => String(id || '').trim())
    .filter(Boolean);

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'move_zone') continue;

    const destinations = (gap.metadata as any)?.moveZoneDestinationChoice;
    if (!Array.isArray(destinations) || destinations.length === 0) continue;

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'move_zone' }> | undefined;
    if (!step || step.kind !== 'move_zone') continue;

    const queueKey = `move_zone_destination:${String((step as any).raw || '')}:${destinations.join(',')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const options = destinations.map((destination) => {
      const normalized = String(destination || '').trim();
      return {
        id: normalized,
        label: normalized === 'battlefield' ? 'Put onto the battlefield' : 'Put into your hand',
        description: normalized,
      };
    });

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: params.controller,
      description: `${sourceName}: Put the chosen cards onto the battlefield or into your hand`,
      mandatory: true,
      sourceId,
      sourceName,
      options,
      minSelections: 1,
      maxSelections: 1,
      oracleIrMoveZoneDestinationChoice: true,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrPriorChosenObjectIdsJson: JSON.stringify(Array.from(new Set(priorChosenObjectIds))),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, { ...params, controller: params.controller }) as any);
  }
}

