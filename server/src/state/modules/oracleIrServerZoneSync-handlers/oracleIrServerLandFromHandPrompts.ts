// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerLandFromHandPrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: queueControllerMayPutLandFromHandPromptsFromOracleIRResult,
//   queueEachPlayerMayPutLandFromHandPromptsFromOracleIRResult, and
//   queueBothPlayersMayPutPermanentFromHandPromptsFromOracleIRResult, plus
//   the draw-if-didn't-put-land predicates they close over.
// Public entry symbols: queueControllerMayPutLandFromHandPromptsFromOracleIRResult,
//   queueEachPlayerMayPutLandFromHandPromptsFromOracleIRResult,
//   queueBothPlayersMayPutPermanentFromHandPromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepStatus, ResolutionStepType } from '../../resolution/index.js';
import {
  isBothPlayersMayPutPermanentFromHandStep,
  isControllerMayPutLandFromHandStep,
  isEachPlayerMayPutLandFromHandStep,
  queueBothPlayersMayPutPermanentFromHandPrompts,
  queueControllerLandPlayOrDrawPrompt,
  queueEachPlayerMayPutLandOrDrawBatch,
  queueLandPlayFromHandPrompt,
} from '../triggerLandPlayPromptUtils.js';

type MutableOracleIRExecutionResult = {
  -readonly [K in keyof OracleIRExecutionResult]: OracleIRExecutionResult[K];
};

function isOpponentDrawIfDidntPutLandConditional(step: OracleEffectStep): boolean {
  if (step.kind !== 'conditional') return false;
  const raw = String(step.condition?.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
  return raw === "each opponent who didn't";
}

function isControllerDrawIfDidntPutLandConditional(step: OracleEffectStep): boolean {
  if (step.kind !== 'conditional') return false;
  const raw = String(step.condition?.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
  if (raw !== "you don't" && raw !== 'you do not') return false;
  const innerSteps = Array.isArray((step as any).steps) ? (step as any).steps : [];
  return innerSteps.some((inner: OracleEffectStep) => inner.kind === 'draw');
}

export function queueControllerMayPutLandFromHandPromptsFromOracleIRResult(
  ctx: GameContext,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    triggerItem?: any;
  },
): void {
  const landStep = [...(result.skippedSteps || []), ...(result.pendingOptionalSteps || [])]
    .find((step) => isControllerMayPutLandFromHandStep(step));
  if (!landStep) return;

  const landStepRaw = String((landStep as any).raw || '').replace(/\u2019/g, "'");
  const hasDrawFallback = /if you don(?:'|')?t,?\s*draw a card/i.test(landStepRaw)
    || (result.pendingContinuationSteps || []).some((step) => isControllerDrawIfDidntPutLandConditional(step));
  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';

  if (hasDrawFallback) {
    queueControllerLandPlayOrDrawPrompt(
      ctx,
      params.controller,
      sourceName,
      params.triggerItem,
    );
  } else {
    queueLandPlayFromHandPrompt(
      ctx,
      params.controller,
      sourceName,
      params.triggerItem,
    );
  }

  if (Array.isArray(result.pendingContinuationSteps) && result.pendingContinuationSteps.length > 0) {
    const filtered = result.pendingContinuationSteps.filter(
      (step) => !isControllerDrawIfDidntPutLandConditional(step),
    );
    if (filtered.length !== result.pendingContinuationSteps.length) {
      (result as MutableOracleIRExecutionResult).pendingContinuationSteps = filtered;
    }
  }
}

export function queueEachPlayerMayPutLandFromHandPromptsFromOracleIRResult(
  ctx: GameContext,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    triggerItem?: any;
  },
): void {
  const landStep = [...(result.skippedSteps || []), ...(result.pendingOptionalSteps || [])]
    .find((step) => isEachPlayerMayPutLandFromHandStep(step));
  if (!landStep) return;

  const gameId = String((ctx as any).gameId || '').trim();
  const batchId = String(params.triggerItem?.id || `land_play_ir_${Date.now()}`);
  if (gameId && gameId !== 'unknown') {
    const hasPendingBatch = ResolutionQueueManager.getQueue(gameId).steps.some(
      (queuedStep) =>
        queuedStep.type === ResolutionStepType.KYNAIOS_CHOICE
        && queuedStep.status === ResolutionStepStatus.PENDING
        && String((queuedStep as any).kynaiosBatchId || '') === batchId,
    );
    if (hasPendingBatch) return;
  }

  const queued = queueEachPlayerMayPutLandOrDrawBatch(ctx, {
    sourceController: params.controller,
    sourceName: String(params.sourceName || 'Ability').trim() || 'Ability',
    sourceId: params.sourceId,
    batchId,
    triggerItem: params.triggerItem,
  });
  if (!queued) return;

  if (Array.isArray(result.pendingContinuationSteps) && result.pendingContinuationSteps.length > 0) {
    const filtered = result.pendingContinuationSteps.filter(
      (step) => !isOpponentDrawIfDidntPutLandConditional(step),
    );
    if (filtered.length !== result.pendingContinuationSteps.length) {
      (result as MutableOracleIRExecutionResult).pendingContinuationSteps = filtered;
    }
  }
}

export function queueBothPlayersMayPutPermanentFromHandPromptsFromOracleIRResult(
  ctx: GameContext,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    triggerItem?: any;
    irCtx?: OracleIRExecutionContext;
  },
): void {
  const step = [
    ...(result.appliedSteps || []),
    ...(result.skippedSteps || []),
    ...(result.pendingOptionalSteps || []),
  ].find((candidate) => isBothPlayersMayPutPermanentFromHandStep(candidate));
  if (!step) return;

  const targetPlayerId = String(
    params.triggerItem?.targetPlayerId ||
      params.triggerItem?.effectData?.targetPlayerId ||
      params.triggerItem?.targets?.[0]?.id ||
      params.triggerItem?.targets?.[0] ||
      params.irCtx?.selectorContext?.targetPlayerId ||
      params.irCtx?.targetPlayerId ||
      '',
  ).trim() as PlayerID;
  if (!targetPlayerId) return;

  queueBothPlayersMayPutPermanentFromHandPrompts(ctx, {
    controller: params.controller,
    targetPlayerId,
    sourceName: String(params.sourceName || 'Ability').trim() || 'Ability',
    triggerItem: params.triggerItem,
  });
}

