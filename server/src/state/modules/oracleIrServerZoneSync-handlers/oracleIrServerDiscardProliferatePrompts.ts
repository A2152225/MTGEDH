// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerDiscardProliferatePrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: queueDiscardChoicePromptsFromOracleIRResult and
//   queueProliferateChoicePromptsFromOracleIRResult.
// Public entry symbols: queueDiscardChoicePromptsFromOracleIRResult,
//   queueProliferateChoicePromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { resolvePlayers } from '../../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import { collectDiscardSelectionOptionsForStep } from '../../../../../rules-engine/src/oracleIRExecutorPlayerStepHandlers.js';
import { getProliferateChoiceTargets } from '../../../../../rules-engine/src/oracleIRExecutorKeywordStepHandlers.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import { getProliferateActionCount } from '../keywordActionRepetition.js';
import { appendQueuedResolutionPromptEvent } from '../resolutionPromptEvents.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
  isOracleIrPlayerChoiceGap,
} from '../oracleIrServerPromptResumeUtils.js';

type MutableOracleIRExecutionResult = {
  -readonly [K in keyof OracleIRExecutionResult]: OracleIRExecutionResult[K];
};

export function queueDiscardChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'discard') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'discard') continue;

    const builtPrompts = collectDiscardSelectionOptionsForStep(state, step, params.irCtx);
    for (const built of builtPrompts) {
      if (!built || built.options.length === 0) continue;
      const isAnyNumberDiscard = built.anyNumberDiscard === true;
      if (!isAnyNumberDiscard && built.discardCount <= 0) continue;

      const queueKey = `discard:${String((step as any).raw || '')}:${built.playerId}`;
      if (queuedKeys.has(queueKey)) continue;
      queuedKeys.add(queueKey);

      try {
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, built.playerId)
          .find(
            (candidate) =>
              candidate.type === ResolutionStepType.DISCARD_SELECTION &&
              sourceId &&
              String((candidate as any)?.sourceId || '') === sourceId &&
              String((candidate as any)?.description || '').includes(String((step as any).raw || ''))
          );
        if (existing) continue;
      } catch {
        // ignore
      }

      const queuedStep = ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: built.playerId,
        description: `${sourceName}: ${String((step as any).raw || 'Discard')}`,
        mandatory: (step as any).optional !== true,
        sourceId,
        sourceName,
        hand: built.options,
        discardCount: built.discardCount,
        minDiscardCount: built.minDiscardCount,
        maxDiscardCount: built.maxDiscardCount,
        anyNumberDiscard: built.anyNumberDiscard === true,
        currentHandSize: built.currentHandSize,
        maxHandSize: built.maxHandSize,
        reason: 'effect',
      } as any, result, params) as any);
      appendQueuedResolutionPromptEvent(ctx, {
        playerId: built.playerId,
        sourceId,
        queuedResolutionStep: queuedStep,
      });
    }
  }
}

export function queueProliferateChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'proliferate') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'proliferate') continue;

    const availableTargets = getProliferateChoiceTargets(state);
    if (availableTargets.length <= 1) continue;

    const choosingPlayerId =
      resolvePlayers(state, (step as any).who, params.irCtx)[0] || params.controller;

    const skipReplacement = (step as any).skipProliferateReplacement === true
      || (gap.metadata as any)?.skipProliferateReplacement === true;
    const actionCount = getProliferateActionCount(state?.battlefield, choosingPlayerId, { skipReplacement });

    for (let actionIndex = 0; actionIndex < actionCount; actionIndex += 1) {
      const queueKey = `proliferate:${String((step as any).raw || '')}:${choosingPlayerId}:${actionIndex}`;
      if (queuedKeys.has(queueKey)) continue;
      queuedKeys.add(queueKey);

      try {
        const proliferateId = `${sourceId || sourceName}:${String((step as any).raw || 'proliferate')}:${actionIndex}`;
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, choosingPlayerId)
          .find(
            (candidate) =>
              candidate.type === ResolutionStepType.PROLIFERATE &&
              sourceId &&
              String((candidate as any)?.sourceId || '') === sourceId &&
              String((candidate as any)?.proliferateId || '') === proliferateId
          );
        if (existing) continue;

        ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
          type: ResolutionStepType.PROLIFERATE,
          playerId: choosingPlayerId,
          description: actionCount > 1
            ? `${sourceName}: ${String((step as any).raw || 'Proliferate')} (${actionIndex + 1}/${actionCount})`
            : `${sourceName}: ${String((step as any).raw || 'Proliferate')}`,
          mandatory: (step as any).optional !== true,
          sourceId,
          sourceName,
          proliferateId,
          // Replacement-created actions do not re-apply Tekuthal (CR 614.5).
          skipProliferateReplacement: true,
          availableTargets: availableTargets.map((target) => ({
            id: target.id,
            name: target.name,
            counters: { ...target.counters },
            isPlayer: target.isPlayer,
            type: target.type,
            ...(target.controller ? { controller: target.controller } : {}),
          })),
        } as any, result, params) as any);
      } catch {
        // ignore
      }
    }
  }
}

