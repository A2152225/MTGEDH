// server/src/socket/game-actions-handlers/gameActionsPayLifeAdditionalCostPrompt.ts
// Queue AdditionalCostModal for a pay-life additional cost (Blitz extras,
// Vampiric Tutor, etc.) and stamp a mid-cast continuation onto a CR 616.1
// pay-life replacement-order step so the cast can resume after the choice.
// Public: queuePayLifeAdditionalCostPrompt, paymentAlreadyResolvedPayLifeCost,
//   stampPayLifeOrderCastContinuation, findOpenPayLifeReplacementOrderStep,
//   PAY_LIFE_COST_RESOLVED_MARKER.

import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { persistQueuedSpellCastStepContinuation } from "./gameActionsSpellCopyHeroicTriggers.js";

export const PAY_LIFE_COST_RESOLVED_MARKER = 'payLifeAdditionalCostResolved';

export function paymentAlreadyResolvedPayLifeCost(payment: unknown): boolean {
  if (!Array.isArray(payment)) return false;
  return payment.some((item: any) =>
    item && (item[PAY_LIFE_COST_RESOLVED_MARKER] === true
      || (item.additionalCostPaid === true && String(item.additionalCostMethod || '') === 'pay_life')));
}

export function findOpenPayLifeReplacementOrderStep(gameId: string, playerId: string): any | null {
  const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any) || [];
  return steps.find((step: any) =>
    step && (step.payLifeReplacementOrderChoice === true || step.payLifeReplacementOrder === true)
  ) || null;
}

export function stampPayLifeOrderCastContinuation(args: {
  game: any;
  gameId: string;
  playerId: string;
  amount: number;
  continuation: Record<string, unknown>;
}): boolean {
  const step = findOpenPayLifeReplacementOrderStep(args.gameId, args.playerId);
  if (!step) return false;
  step.castSpellFromHandArgs = { ...args.continuation };
  step.payLifeAmount = args.amount;
  step.payLifePlayerId = args.playerId;
  persistQueuedSpellCastStepContinuation(args.gameId, args.game, {
    playerId: args.playerId,
    cardId: String((args.continuation as any).cardId || ''),
    queuedResolutionStep: { ...step },
  });
  return true;
}

export function queuePayLifeAdditionalCostPrompt(args: {
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  cardInHand: any;
  amount: number;
  payment?: unknown;
  targets?: unknown;
  xValue?: unknown;
  alternateCostId?: string;
  convokeTappedCreatures?: unknown;
}): boolean {
  const amount = Math.max(1, Math.floor(Number(args.amount || 0)));
  if (!args.gameId || !args.playerId || !args.cardId || !amount) return false;

  const existing = ResolutionQueueManager
    .getStepsForPlayer(args.gameId, args.playerId as any)
    .find((step: any) =>
      step?.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT
      && String(step?.sourceId || '') === String(args.cardId)
      && String(step?.costType || '') === 'pay_life');
  if (existing) return true;

  const name = String(args.cardInHand?.name || 'Spell');
  const imageUrl = args.cardInHand?.image_uris?.small || args.cardInHand?.image_uris?.normal;
  const isKicker = String(args.alternateCostId || '').trim().toLowerCase() === 'kicker';
  const payLifeCostStep = ResolutionQueueManager.addStep(args.gameId, {
    type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
    playerId: args.playerId as any,
    sourceId: args.cardId,
    sourceName: name,
    sourceImage: imageUrl,
    description: isKicker
      ? `Kicker: Pay ${amount} life to kick ${name}.`
      : `As an additional cost to cast ${name}, pay ${amount} life.`,
    mandatory: true,
    cardId: args.cardId,
    cardName: name,
    costType: 'pay_life',
    amount,
    title: isKicker ? `Kicker: Pay ${amount} life` : `Pay ${amount} life to cast ${name}`,
    imageUrl,
    availableCards: [],
    availableTargets: [],
    canCancel: true,
    allowCancel: true,
    castSpellFromHandArgs: {
      cardId: args.cardId,
      payment: args.payment,
      targets: args.targets,
      xValue: args.xValue,
      alternateCostId: args.alternateCostId,
      convokeTappedCreatures: args.convokeTappedCreatures,
    },
  } as any);

  if (String(args.alternateCostId || '') === 'madness') {
    (payLifeCostStep as any).declineMadnessOnCancel = true;
    (payLifeCostStep as any).castFromExileDeclineDestination = 'graveyard';
  }

  persistQueuedSpellCastStepContinuation(args.gameId, args.game, {
    playerId: args.playerId,
    cardId: args.cardId,
    queuedResolutionStep: { ...(payLifeCostStep as any) },
  });
  return true;
}
