/**
 * socket/resolution-handlers/exploreDecisionResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse switch).
 * Cluster moved: EXPLORE_DECISION and BATCH_EXPLORE_DECISION case bodies (CR 701.40 explore).
 * Public entry symbols: handleExploreDecisionResponse, handleBatchExploreDecisionResponse.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { getPlayerName } from "../util.js";

/** Single-permanent explore decision: reveal top card, keep/bin, then queue the next explorer. */
export function handleExploreDecisionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  const permanentId = String(selections?.permanentId || (step as any)?.permanentId || step.sourceId || '');
  const toGraveyard = Boolean(selections?.toGraveyard);

  const cards = typeof game.peekTopN === 'function' ? game.peekTopN(pid, 1) : [];
  if (!cards || cards.length === 0) return;

  const revealedCard = cards[0];
  const typeLine = String(revealedCard?.type_line || '').toLowerCase();
  const isLand = typeLine.includes('land');

  const battlefield = (game.state as any)?.battlefield || [];
  const exploringPerm = battlefield.find((p: any) => p?.id === permanentId && p?.controller === pid);
  const exploringName = exploringPerm?.card?.name || (step as any)?.permanentName || step.sourceName || 'Creature';

  game.applyEvent({
    type: 'exploreResolve',
    playerId: pid,
    resolvedStepId: String((step as any).id || '').trim(),
    resolvedStepType: ResolutionStepType.EXPLORE_DECISION,
    permanentId,
    revealedCardId: revealedCard.id,
    isLand,
    toGraveyard: isLand ? false : toGraveyard,
  });

  appendEvent(gameId, (game as any).seq ?? 0, 'exploreResolve', {
    playerId: pid,
    resolvedStepId: String((step as any).id || '').trim(),
    resolvedStepType: ResolutionStepType.EXPLORE_DECISION,
    permanentId,
    revealedCardId: revealedCard.id,
    isLand,
    toGraveyard,
  });

  let resultMessage: string;
  if (isLand) {
    resultMessage = `${getPlayerName(game, pid)} puts ${revealedCard.name} into their hand.`;
  } else if (toGraveyard) {
    resultMessage = `${getPlayerName(game, pid)} puts a +1/+1 counter on ${exploringName} and puts ${revealedCard.name} into their graveyard.`;
  } else {
    resultMessage = `${getPlayerName(game, pid)} puts a +1/+1 counter on ${exploringName} and keeps ${revealedCard.name} on top of their library.`;
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: resultMessage,
    ts: Date.now(),
  });

  const remainingPermanentIds = Array.isArray((step as any)?.remainingPermanentIds)
    ? ((step as any).remainingPermanentIds as any[])
        .map((id: any) => String(id || '').trim())
        .filter((id: string) => id.length > 0)
    : [];

  if (remainingPermanentIds.length > 0) {
    const updatedBattlefield = (game.state as any)?.battlefield || [];

    for (let index = 0; index < remainingPermanentIds.length; index++) {
      const nextPermanentId = remainingPermanentIds[index];
      const nextPerm = updatedBattlefield.find((p: any) => p?.id === nextPermanentId && p?.controller === pid);
      if (!nextPerm) continue;

      const nextCards = typeof game.peekTopN === 'function' ? game.peekTopN(pid, 1) : [];
      if (!nextCards || nextCards.length === 0) break;

      const nextRevealedCard = nextCards[0];
      const nextTypeLine = String(nextRevealedCard?.type_line || '').toLowerCase();
      const nextRemaining = remainingPermanentIds.slice(index + 1);

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.EXPLORE_DECISION,
        playerId: pid as any,
        mandatory: true,
        sourceId: nextPermanentId,
        sourceName: nextPerm?.card?.name || 'Creature',
        description: `${nextPerm?.card?.name || 'Creature'} explores`,
        permanentId: nextPermanentId,
        permanentName: nextPerm?.card?.name || 'Creature',
        revealedCard: nextRevealedCard,
        isLand: nextTypeLine.includes('land'),
        remainingPermanentIds: nextRemaining,
      } as any);
      break;
    }
  }
}

/** Batched explore prompt: one decision per exploring permanent, resolved in order. */
export function handleBatchExploreDecisionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  const decisions: any[] = Array.isArray(selections?.decisions) ? selections.decisions : [];
  const results: string[] = [];

  for (const decision of decisions) {
    const permanentId = String(decision?.permanentId || '');
    const toGraveyard = Boolean(decision?.toGraveyard);
    if (!permanentId) continue;

    const cards = typeof game.peekTopN === 'function' ? game.peekTopN(pid, 1) : [];
    if (!cards || cards.length === 0) continue;

    const revealedCard = cards[0];
    const typeLine = String(revealedCard?.type_line || '').toLowerCase();
    const isLand = typeLine.includes('land');

    const battlefield = (game.state as any)?.battlefield || [];
    const exploringPerm = battlefield.find((p: any) => p?.id === permanentId && p?.controller === pid);
    const exploringName = exploringPerm?.card?.name || 'Creature';

    game.applyEvent({
      type: 'exploreResolve',
      playerId: pid,
      resolvedStepId: String((step as any).id || '').trim(),
      resolvedStepType: ResolutionStepType.BATCH_EXPLORE_DECISION,
      permanentId,
      revealedCardId: revealedCard.id,
      isLand,
      toGraveyard: isLand ? false : toGraveyard,
    });

    appendEvent(gameId, (game as any).seq ?? 0, 'exploreResolve', {
      playerId: pid,
      resolvedStepId: String((step as any).id || '').trim(),
      resolvedStepType: ResolutionStepType.BATCH_EXPLORE_DECISION,
      permanentId,
      revealedCardId: revealedCard.id,
      isLand,
      toGraveyard: isLand ? false : toGraveyard,
    });

    if (isLand) {
      results.push(`${exploringName} → ${revealedCard.name} to hand`);
    } else if (toGraveyard) {
      results.push(`${exploringName} → +1/+1 counter, ${revealedCard.name} to graveyard`);
    } else {
      results.push(`${exploringName} → +1/+1 counter, ${revealedCard.name} on top`);
    }
  }

  if (results.length > 0) {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} resolves explores: ${results.join('; ')}.`,
      ts: Date.now(),
    });
  }
}
