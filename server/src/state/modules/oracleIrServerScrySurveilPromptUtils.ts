/**
 * Extracted from oracleIrServerZoneSync.ts.
 * Queues scry / surveil resolution prompts from IR automation gaps.
 * Empty-library scry/surveil is a no-op (do not queue cards: []).
 * Entry: queueTopLibraryChoicePromptsFromOracleIRResult.
 */
import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep, OracleQuantity } from '../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../rules-engine/src/oracleIRExecutor.js';
import { resolvePlayers } from '../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import { resolveOracleQuantityForPlayer } from '../../../../rules-engine/src/oracleIRExecutorResolveQuantity.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';
import {
  attachOracleIrResumeMetadata,
  isOracleIrPlayerChoiceGap,
  normalizeTopLibraryPromptCard,
} from './oracleIrServerPromptResumeUtils.js';

export function queueTopLibraryChoicePromptsFromOracleIRResult(
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

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    const kind = String(gap.stepKind || '');
    if (kind !== 'scry' && kind !== 'surveil') continue;

    const step = (result.skippedSteps || []).find(
      (candidate) =>
        String(candidate.kind || '') === kind &&
        String((candidate as any).raw || '') === String(gap.raw || ''),
    ) as OracleEffectStep | undefined;
    if (!step) continue;

    const playerIds = [...resolvePlayers(state, (step as any).who, params.irCtx)];
    for (const playerId of playerIds) {
      const count = resolveOracleQuantityForPlayer(
        state,
        params.controller,
        (step as any).amount as OracleQuantity,
        params.irCtx,
        playerId,
        { whereX: (step as any).whereX },
      );
      if (count === null || count <= 0) continue;

      const queueKey = `${kind}:${playerId}:${String((step as any).raw || '')}`;
      if (queuedKeys.has(queueKey)) continue;
      queuedKeys.add(queueKey);

      const libraries = (ctx as any).libraries as Map<string, any[]> | undefined;
      const library = Array.isArray(libraries?.get?.(playerId))
        ? libraries.get(playerId)!
        : Array.isArray(
            (state.players || []).find((player: any) => String(player?.id || '') === playerId)?.library,
          )
          ? (state.players || []).find((player: any) => String(player?.id || '') === playerId).library
          : [];
      const actualCount = Math.min(count, library.length);
      if (actualCount <= 0) continue;

      const cards = library.slice(0, actualCount).map(normalizeTopLibraryPromptCard);

      if (kind === 'scry') {
        const queuedStep = ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
          type: ResolutionStepType.SCRY,
          playerId,
          description: `${sourceName}: Scry ${count}`,
          mandatory: true,
          sourceId,
          sourceName,
          scryCount: count,
          cards,
          persistOracleIrScryResolve: true,
          persistOracleIrScryResolveReason: 'stack_resolution',
          oracleIrChoiceStepJson: JSON.stringify([step]),
          oracleIrControllerId: params.controller,
          oracleIrSourceId: sourceId,
          oracleIrSourceName: sourceName,
        } as any, result, params) as any);
        appendQueuedResolutionPromptEvent(ctx, {
          playerId,
          sourceId,
          queuedResolutionStep: queuedStep,
        });
        continue;
      }

      const queuedStep = ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.SURVEIL,
        playerId,
        description: `${sourceName}: Surveil ${actualCount}`,
        mandatory: true,
        sourceId,
        sourceName,
        surveilCount: actualCount,
        cards,
        persistOracleIrSurveilResolve: true,
        persistOracleIrSurveilResolveReason: 'stack_resolution',
        oracleIrChoiceStepJson: JSON.stringify([step]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
      } as any, result, params) as any);
      appendQueuedResolutionPromptEvent(ctx, {
        playerId,
        sourceId,
        queuedResolutionStep: queuedStep,
      });
    }
  }
}
