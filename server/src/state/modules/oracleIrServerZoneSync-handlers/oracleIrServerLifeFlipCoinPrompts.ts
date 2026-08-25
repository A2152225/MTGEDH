// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerLifeFlipCoinPrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: queueRedistributeLifeTotalsPromptsFromOracleIRResult and
//   queueFlipCoinLifeStakesPromptsFromOracleIRResult, plus
//   readServerPlayerLifeTotal.
// Public entry symbols: queueRedistributeLifeTotalsPromptsFromOracleIRResult,
//   queueFlipCoinLifeStakesPromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { resolvePlayers } from '../../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import { queueFlipCoinLifeStakesLoop } from '../flipCoinLifeStakes.js';
import { appendQueuedResolutionPromptEvent } from '../resolutionPromptEvents.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
  isOracleIrPlayerChoiceGap,
} from '../oracleIrServerPromptResumeUtils.js';

function readServerPlayerLifeTotal(state: any, playerId: string): number {
  const normalizedId = String(playerId || '').trim();
  if (!normalizedId) return 0;
  const lifeRecord = state?.life;
  if (lifeRecord && Number.isFinite(Number(lifeRecord[normalizedId]))) {
    return Math.max(0, Math.floor(Number(lifeRecord[normalizedId])));
  }
  const player = (state?.players || []).find((entry: any) => String(entry?.id || '').trim() === normalizedId);
  if (player && Number.isFinite(Number(player.life))) {
    return Math.max(0, Math.floor(Number(player.life)));
  }
  return Math.max(0, Math.floor(Number(state?.startingLife ?? 40)));
}

export function queueRedistributeLifeTotalsPromptsFromOracleIRResult(
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
    if (String(gap.stepKind || '') !== 'redistribute_life_totals') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'redistribute_life_totals') continue;

    const players = (state?.players || [])
      .map((player: any) => {
        const id = String(player?.id || '').trim();
        if (!id) return null;
        return {
          id,
          name: String(player?.name || id).trim() || id,
          life: readServerPlayerLifeTotal(state, id),
        };
      })
      .filter(Boolean) as Array<{ id: string; name: string; life: number }>;

    if (players.length <= 1) continue;

    const choosingPlayerId = params.controller;
    const queueKey = `redistribute_life:${String((step as any).raw || '')}:${choosingPlayerId}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    try {
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, choosingPlayerId)
        .find(
          (candidate) =>
            candidate.type === ResolutionStepType.LIFE_REDISTRIBUTION &&
            sourceId &&
            String((candidate as any)?.sourceId || '') === sourceId &&
            String((candidate as any)?.description || '').includes(String((step as any).raw || '')),
        );
      if (existing) continue;
    } catch {
      // ignore
    }

    const queuedStep = ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.LIFE_REDISTRIBUTION,
      playerId: choosingPlayerId,
      description: `${sourceName}: ${String((step as any).raw || 'Redistribute life totals')}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      redistributionId: `${sourceId || sourceName}:${String((step as any).raw || 'redistribute_life')}`,
      players,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
    appendQueuedResolutionPromptEvent(ctx, {
      playerId: choosingPlayerId,
      sourceId,
      queuedResolutionStep: queuedStep,
    });
  }
}

export function queueFlipCoinLifeStakesPromptsFromOracleIRResult(
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

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'flip_coin_life_stakes') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'flip_coin_life_stakes') continue;

    const controllerId = resolvePlayers(state, (step as any).who, params.irCtx)[0] || params.controller;
    let opponentId =
      String((params.irCtx as any)?.targetOpponentId || (params.irCtx as any)?.targetPlayerId || '').trim();
    if (!opponentId) {
      const opponents = (Array.isArray(state?.players) ? state.players : [])
        .map((player: any) => String(player?.id || '').trim())
        .filter((id: string) => id && id !== String(controllerId));
      opponentId = opponents[0] || '';
    }
    if (!opponentId) continue;

    const stake = Math.max(1, Math.floor(Number((step as any).initialStake || 1) || 1));
    queueFlipCoinLifeStakesLoop(ctx, {
      controllerId: String(controllerId),
      opponentId,
      stake,
      sourceName: String(params.sourceName || 'Ability'),
      sourceId: params.sourceId,
      flipIndex: 0,
      doubleEachFlip: (step as any).doubleEachFlip !== false,
    });
  }
}

