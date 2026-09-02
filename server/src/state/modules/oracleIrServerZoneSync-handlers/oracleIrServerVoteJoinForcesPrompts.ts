// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerVoteJoinForcesPrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: queueJoinForcesPromptsFromOracleIRResult,
//   queueTemptingOfferPromptsFromOracleIRResult, and
//   queueVotePromptsFromOracleIRResult, plus the vote helpers they close
//   over (buildVoteBallotChoices, buildApnapVoterOrder).
// Public entry symbols: queueJoinForcesPromptsFromOracleIRResult,
//   queueTemptingOfferPromptsFromOracleIRResult,
//   queueVotePromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { resolvePlayers } from '../../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import { listLivingGamePlayers } from '../priorityEligibility.js';
import { queueJoinForcesResolutionSteps } from '../joinForcesResolutionQueue.js';
import { queueTemptingOfferResolutionSteps } from '../temptingOfferResolutionQueue.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
  isOracleIrPlayerChoiceGap,
} from '../oracleIrServerPromptResumeUtils.js';

function buildVoteBallotChoices(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'vote' }>,
  /**
   * Player currently casting the ballot. For "another player" / "each other player"
   * filters this must be the **voter**, not the spell controller.
   */
  voterId: PlayerID,
): string[] {
  const ballot = String((step as any).ballot || 'labels');
  if (ballot === 'players') {
    const livingIds = new Set(
      listLivingGamePlayers({ state }).map((p: any) => String(p?.id || '').trim()).filter(Boolean),
    );
    const filter = String((step as any).ballotFilter || '').toLowerCase();
    return [...livingIds].filter((id: string) => {
      if (/\banother\s+player\b|\beach\s+other\s+player\b/i.test(filter) && id === voterId) {
        return false;
      }
      return true;
    });
  }
  if (ballot === 'permanents') {
    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const filter = String((step as any).ballotFilter || '').toLowerCase();
    return battlefield
      .filter((perm: any) => {
        if (!perm?.id) return false;
        const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
        if (/\bcreature\b/.test(filter) && !typeLine.includes('creature')) return false;
        if (/\bnonland\s+permanent\b/.test(filter) && typeLine.includes('land')) return false;
        if (/\byou don't control\b|\byou do not control\b/.test(filter) && String(perm.controller || '') === voterId) {
          return false;
        }
        return true;
      })
      .map((perm: any) => String(perm.id));
  }
  return (Array.isArray((step as any).choices) ? (step as any).choices : [])
    .map((choice: unknown) => String(choice || '').trim())
    .filter(Boolean);
}

function buildApnapVoterOrder(
  state: any,
  startingWith: string | undefined,
  controller: PlayerID,
): string[] {
  const players = listLivingGamePlayers({ state })
    .map((p: any) => String(p?.id || '').trim())
    .filter(Boolean);
  if (players.length === 0) return [controller];
  const start =
    String(startingWith || '').trim() ||
    String(state?.activePlayer || state?.turnPlayer || controller).trim() ||
    controller;
  const startIdx = Math.max(0, players.indexOf(start));
  return [...players.slice(startIdx), ...players.slice(0, startIdx)];
}

export function queueJoinForcesPromptsFromOracleIRResult(
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
    if (String(gap.stepKind || '') !== 'join_forces') continue;

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'join_forces' }> | undefined;
    if (!step || step.kind !== 'join_forces') continue;

    const sourceName = String(params.sourceName || 'Join Forces').trim() || 'Join Forces';
    const sourceId = String(params.sourceId || '').trim() || undefined;
    const resumePayload = attachOracleIrResumeMetadata(
      {},
      result,
      { controller: params.controller, sourceId, sourceName, irCtx: params.irCtx },
    );
    // Join Forces X is the contribution total, not the spell's cost X (e.g. {X}{U}).
    delete (resumePayload as { oracleIrXValue?: number }).oracleIrXValue;

    const continuationRaw = (result.pendingContinuationSteps || [])
      .map((entry) => String((entry as { raw?: string }).raw || '').trim())
      .filter(Boolean)
      .join(' ');
    const effectDescription = [String(step.raw || '').trim(), continuationRaw].filter(Boolean).join(' ');

    queueJoinForcesResolutionSteps(ctx, {
      controller: params.controller,
      cardName: sourceName,
      sourceId,
      sourceName,
      effectDescription: effectDescription || String(step.raw || sourceName),
      logPrefix: 'oracleIR joinForces',
      oracleIrResumeStepsJson: String(resumePayload.oracleIrResumeStepsJson || '').trim() || undefined,
      oracleIrControllerId: String(resumePayload.oracleIrControllerId || params.controller).trim() || undefined,
      oracleIrSourceId: String(resumePayload.oracleIrSourceId || sourceId || '').trim() || undefined,
      oracleIrSourceName: String(resumePayload.oracleIrSourceName || sourceName).trim() || undefined,
    });
    return;
  }
}

export function queueTemptingOfferPromptsFromOracleIRResult(
  ctx: GameContext,
  _state: any,
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
    if (String(gap.stepKind || '') !== 'tempting_offer') continue;

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'tempting_offer' }> | undefined;
    if (!step || step.kind !== 'tempting_offer') continue;

    const sourceName = String(params.sourceName || 'Tempting Offer Spell').trim() || 'Tempting Offer Spell';
    const sourceId = String(params.sourceId || '').trim() || undefined;
    const continuationRaw = (result.pendingContinuationSteps || [])
      .map((entry) => String((entry as { raw?: string }).raw || '').trim())
      .filter(Boolean)
      .join(' ');
    const effectDescription = [String(step.raw || '').trim(), continuationRaw].filter(Boolean).join(' ');

    queueTemptingOfferResolutionSteps(ctx, {
      controller: params.controller,
      cardName: sourceName,
      sourceId,
      sourceName,
      effectDescription: effectDescription || String(step.raw || sourceName),
      logPrefix: 'oracleIR temptingOffer',
    });
    return;
  }
}

export function queueVotePromptsFromOracleIRResult(
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
    if (String(gap.stepKind || '') !== 'vote') continue;

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'vote' }> | undefined;
    if (!step || step.kind !== 'vote') continue;

    const queueKey = `vote:${String((step as any).raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const voters = resolvePlayers(state, (step as any).voters, params.irCtx);
    const startingWithPlayers = (step as any).startingWith
      ? resolvePlayers(state, (step as any).startingWith, params.irCtx)
      : [];
    const voterOrder = buildApnapVoterOrder(
      state,
      startingWithPlayers[0] || params.controller,
      params.controller,
    ).filter((id) => voters.length === 0 || voters.includes(id));
    if (voterOrder.length === 0) continue;

    const firstVoter = voterOrder[0]!;
    // Ballot choices are voter-relative (e.g. "another player" excludes the voter).
    const firstVoterChoices = buildVoteBallotChoices(state, step, firstVoter as PlayerID);
    if (firstVoterChoices.length < 1) continue;

    const voteId = `vote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const resumeSteps = [
      step,
      ...((result.pendingContinuationSteps || []) as OracleEffectStep[]),
    ];

    const payload = attachOracleIrResumeMetadata(
      {
        type: ResolutionStepType.VOTE,
        playerId: firstVoter,
        description: `${sourceName}: ${String((step as any).raw || 'Vote')}`,
        mandatory: true,
        sourceId,
        sourceName,
        voteId,
        choices: firstVoterChoices,
        votesSubmitted: [],
        secret: Boolean((step as any).secret),
        oracleIrVoterOrder: voterOrder,
        oracleIrChoiceStepJson: JSON.stringify([step]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
      } as any,
      result,
      { ...params, controller: params.controller },
    );
    // Resume must re-run the vote step itself with tallies, then continuations.
    payload.oracleIrResumeStepsJson = JSON.stringify(resumeSteps);
    ResolutionQueueManager.addStep(gameId, payload as any);
  }
}
