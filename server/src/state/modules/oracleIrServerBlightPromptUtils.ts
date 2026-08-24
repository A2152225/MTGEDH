/**
 * Extracted from oracleIrServerZoneSync.ts.
 * Queues blight TARGET_SELECTION prompts from IR automation gaps and persists
 * the APNAP batch as resolveTopOfStackPrompt.queuedResolutionSteps.
 * Entry: queueBlightChoicePromptsFromOracleIRResult.
 */
import type { PlayerID } from '../../../../shared/src/index.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../rules-engine/src/oracleIRExecutor.js';
import { collectBlightTargetSelectionConfigs } from '../../../../rules-engine/src/oracleIRExecutorKeywordStepHandlers.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
  isOracleIrPlayerChoiceGap,
} from './oracleIrServerPromptResumeUtils.js';

export function queueBlightChoicePromptsFromOracleIRResult(
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
    if (String(gap.stepKind || '') !== 'blight') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'blight') continue;

    const configs = collectBlightTargetSelectionConfigs(state, step, params.irCtx);
    if (configs.length === 0) continue;

    const stepConfigs = configs.map((config) => {
      const queueKey = `blight:${String((step as any).raw || '')}:${config.playerId}`;
      if (queuedKeys.has(queueKey)) return null;
      queuedKeys.add(queueKey);

      return attachOracleIrResumeMetadata({
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: config.playerId,
        description: `${sourceName}: Blight ${config.count} ? choose a creature you control to put ${config.count} -1/-1 counter${config.count === 1 ? '' : 's'} on it.`,
        mandatory: (step as any).optional !== true,
        sourceId,
        sourceName,
        validTargets: [...config.validTargets],
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'creature you control',
        keywordBlight: true,
        keywordBlightStage: 'select_target',
        keywordBlightController: config.playerId,
        keywordBlightN: config.count,
        keywordBlightSourceName: `${sourceName}: Blight ${config.count}`,
      } as any, result, params) as any;
    }).filter(Boolean) as any[];

    if (stepConfigs.length === 0) continue;

    const players = (state as any).players || [];
    const turnOrder: PlayerID[] = players
      .map((player: any) => player?.id)
      .filter((id: unknown) => typeof id === 'string') as PlayerID[];
    const activePlayerId: PlayerID =
      (state as any).turnPlayer ||
      (state as any).activePlayerId ||
      players[(state as any).activePlayerIndex || 0]?.id ||
      params.controller;

    const added = stepConfigs.length === 1
      ? [ResolutionQueueManager.addStep(gameId, stepConfigs[0])]
      : ResolutionQueueManager.addStepsWithAPNAP(
          gameId,
          stepConfigs,
          turnOrder,
          activePlayerId,
        );

    appendQueuedResolutionPromptEvent(ctx, {
      playerId: String(added[0]?.playerId || ''),
      sourceId,
      queuedResolutionSteps: added,
    });
  }
}
