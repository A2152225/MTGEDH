import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { listLivingGamePlayers } from './priorityEligibility.js';

function serializeTemptingOfferSteps(
  steps: readonly any[],
  cardName: string,
): Array<Record<string, unknown>> {
  return steps
    .filter((step: any) =>
      step?.type === ResolutionStepType.TEMPTING_OFFER
      && String(step?.cardName || '') === cardName,
    )
    .map((step: any) => ({
      id: String(step.id),
      type: String(step.type),
      playerId: String(step.playerId),
      description: String(step.description || ''),
      mandatory: step.mandatory !== false,
      sourceId: step.sourceId ? String(step.sourceId) : undefined,
      sourceName: step.sourceName ? String(step.sourceName) : undefined,
      sourceImage: step.sourceImage,
      cardName: step.cardName ? String(step.cardName) : undefined,
      effectDescription: step.effectDescription ? String(step.effectDescription) : undefined,
      cardImageUrl: step.cardImageUrl,
      initiator: step.initiator ? String(step.initiator) : undefined,
      isOpponent: step.isOpponent === true,
      priority: Number(step.priority || 0),
    }));
}

export function queueTemptingOfferResolutionSteps(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    cardName: string;
    sourceId?: string;
    sourceName?: string;
    sourceImage?: string;
    effectDescription: string;
    cardImageUrl?: string;
    logPrefix?: string;
  },
): boolean {
  const state = (ctx as any).state;
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return false;

  const cardName = String(params.cardName || 'Tempting Offer Spell').trim() || 'Tempting Offer Spell';
  const controller = params.controller;
  const allPlayers = listLivingGamePlayers(ctx);
  const opponents = allPlayers.filter((player: any) => String(player?.id || '') !== String(controller));
  if (opponents.length === 0) {
    debug(2, `[${params.logPrefix || 'temptingOffer'}] ${cardName} has no opponents — skip offer prompts`);
    return false;
  }

  const existingQueue = ResolutionQueueManager.getQueue(gameId);
  const alreadyQueued = (existingQueue.steps || []).some(
    (step: any) =>
      String(step?.type || '') === String(ResolutionStepType.TEMPTING_OFFER)
      && String(step?.cardName || '') === cardName,
  );
  if (alreadyQueued) {
    debug(2, `[${params.logPrefix || 'temptingOffer'}] ${cardName} already queued TEMPTING_OFFER; skip duplicate`);
    return true;
  }

  if ((ctx as any).isReplaying) {
    debug(2, `[${params.logPrefix || 'temptingOffer'}] skipping resolution steps during replay`);
    return true;
  }

  const turnOrder = allPlayers.map((player: any) => player.id);
  const stepConfigs = opponents.map((player: any) => {
    const playerId = String(player.id || '').trim() as PlayerID;
    return {
      type: ResolutionStepType.TEMPTING_OFFER,
      playerId,
      description: `${cardName}: Do you accept the tempting offer?`,
      mandatory: false,
      sourceId: params.sourceId,
      sourceName: params.sourceName || cardName,
      sourceImage: params.sourceImage,
      cardName,
      effectDescription: params.effectDescription,
      cardImageUrl: params.cardImageUrl,
      initiator: controller,
      isOpponent: true,
    };
  });

  ResolutionQueueManager.addStepsWithAPNAP(
    gameId,
    stepConfigs,
    turnOrder,
    (state as any).activePlayer || controller,
  );

  try {
    const queue = ResolutionQueueManager.getQueue(gameId);
    const persistedSteps = serializeTemptingOfferSteps(queue.steps, cardName);
    appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'temptingOfferInitiated', {
      cardName,
      initiator: controller,
      steps: persistedSteps,
    });
  } catch (err) {
    debugWarn(1, `[${params.logPrefix || 'temptingOffer'}] Failed to persist temptingOfferInitiated event:`, err);
  }

  debug(
    2,
    `[${params.logPrefix || 'temptingOffer'}] ${cardName} created ${opponents.length} TEMPTING_OFFER resolution steps`,
  );
  return true;
}
