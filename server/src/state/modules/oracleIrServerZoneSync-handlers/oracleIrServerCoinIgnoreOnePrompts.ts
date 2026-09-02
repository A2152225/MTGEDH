// Origin parent: oracleIrServerApplyOnServer.ts
// Cluster: Krark's Thumb family ignore-one OPTION_CHOICE. Queued from applyOracleIRStepsOnServer.
// Public: queueCoinIgnoreOnePromptsFromOracleIRResult.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
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
  unwrapYouDoResumeSteps,
} from '../oracleIrServerPromptResumeUtils.js';

function inheritResumeJson(gameId: string, result: OracleIRExecutionResult): string {
  const pending = result.pendingContinuationSteps;
  if (Array.isArray(pending) && pending.length > 0) {
    return JSON.stringify(unwrapYouDoResumeSteps(pending));
  }
  const queue = ResolutionQueueManager.getQueue(gameId);
  for (const step of queue?.steps || []) {
    const json = String((step as any)?.oracleIrResumeStepsJson || '').trim();
    if (json && (step as any)?.coinIgnoreOneChoice === true) return json;
  }
  return '';
}

export function queueCoinIgnoreOnePromptsFromOracleIRResult(
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
  const inheritedResumeJson = inheritResumeJson(gameId, result);

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'flip_coin') continue;
    if (gap.metadata?.coinIgnoreOneChoice !== true) continue;

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'flip_coin' }> | undefined;
    if (!step) continue;

    const playerId = String(gap.metadata?.pendingCoinPlayerId || params.controller || '').trim() as PlayerID;
    const first = String(gap.metadata?.pendingCoinFirst || '').trim();
    const second = String(gap.metadata?.pendingCoinSecond || '').trim();
    if (!playerId || (first !== 'heads' && first !== 'tails') || (second !== 'heads' && second !== 'tails')) {
      continue;
    }

    const payload: Record<string, unknown> = {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      mandatory: true,
      sourceId,
      sourceName,
      description: `${sourceName}: Two coins were flipped. Ignore one.`,
      minSelections: 1,
      maxSelections: 1,
      coinIgnoreOneChoice: true,
      pendingCoinFirst: first,
      pendingCoinSecond: second,
      coinIgnoreOneRawFlipsJson: String(gap.metadata?.coinIgnoreOneRawFlipsJson || ''),
      coinIgnoreOneKeepChoicesJson: String(gap.metadata?.coinIgnoreOneKeepChoicesJson || ''),
      coinIgnoreOneCall: String(gap.metadata?.coinIgnoreOneCall || ''),
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
      options: [
        {
          id: 'first',
          label: `Keep ${first === 'heads' ? 'Heads' : 'Tails'}`,
          description: `Ignore the second coin (${second})`,
        },
        {
          id: 'second',
          label: `Keep ${second === 'heads' ? 'Heads' : 'Tails'}`,
          description: `Ignore the first coin (${first})`,
        },
      ],
    };

    const queued = attachOracleIrResumeMetadata(payload, result, params) as any;
    if (!String(queued.oracleIrResumeStepsJson || '').trim() && inheritedResumeJson) {
      queued.oracleIrResumeStepsJson = inheritedResumeJson;
    }
    ResolutionQueueManager.addStep(gameId, queued);
    void state;
  }
}
