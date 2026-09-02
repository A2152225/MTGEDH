// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster: queue X_VALUE_SELECTION for Oracle IR choose_number gaps
//   (Yusri "choose a number between 1 and 5").
// Public: queueChooseNumberPromptsFromOracleIRResult
// Called from applyOracleIRStepsOnServer; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
  isOracleIrPlayerChoiceGap,
} from '../oracleIrServerPromptResumeUtils.js';

export function queueChooseNumberPromptsFromOracleIRResult(
  ctx: GameContext,
  _state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx?: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'choose_number') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'choose_number') continue;

    const minValue = Math.max(0, Math.floor(Number((step as { min?: number }).min ?? 0)));
    const maxValue = Math.max(minValue, Math.floor(Number((step as { max?: number }).max ?? minValue)));
    const queueKey = `choose_number:${String((step as any).raw || '')}:${params.controller}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.X_VALUE_SELECTION,
      playerId: params.controller,
      description: `${sourceName}: Choose a number between ${minValue} and ${maxValue}.`,
      mandatory: true,
      sourceId,
      sourceName,
      minValue,
      maxValue,
      oracleIrChooseNumberChoice: true,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}
