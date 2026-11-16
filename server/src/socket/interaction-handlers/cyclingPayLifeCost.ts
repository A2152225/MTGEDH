// server/src/socket/interaction-handlers/cyclingPayLifeCost.ts
// Street Wraith-style "Cycling—Pay N life": queue the existing pay-life
// ADDITIONAL_COST_PAYMENT confirm, then discard and put cycling on the stack
// after the player confirms.
// Public: parseCyclingPayLifeAmount, queueCyclingPayLifePrompt,
//   completeCyclingAfterCostPaid, tryResumeCyclingAfterPayLife.

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../../state/modules/graveyardEntryUtils.js";
import { canPayLifeAmount } from "../../state/modules/batch97PayLife.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { queueCycleTriggeredAbilities } from "../../state/modules/triggers/cycle.js";
import { queueDiscardTriggeredAbilities } from "../../state/modules/triggers/discard.js";
import { broadcastGame, getPlayerName } from "../util.js";
import type { CyclingActivationDefinition } from "./interactionCyclingActivationDefinitions.js";

const LIFE_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export const CYCLING_PAY_LIFE_FLAG = 'cyclingActivation';

export function parseCyclingPayLifeAmount(cost: unknown): number | null {
  const raw = String(cost || '').trim().replace(/[\u2014\u2013]/g, '-');
  const match = raw.match(/^(?:cycling\s*-+\s*)?pay\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\.?$/i);
  if (!match) return null;
  const token = String(match[1] || '').toLowerCase();
  const amount = /^\d+$/.test(token) ? Number.parseInt(token, 10) : (LIFE_WORDS[token] ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function queueCyclingPayLifePrompt(args: {
  game: any;
  gameId: string;
  playerId: string;
  card: any;
  cardId: string;
  abilityId: string;
  amount: number;
  xValue?: number;
}): boolean {
  const amount = Math.max(1, Math.floor(Number(args.amount || 0)));
  if (!args.gameId || !args.playerId || !args.cardId || !amount) return false;
  if (!canPayLifeAmount(args.game?.state, args.playerId, amount)) return false;

  const existing = ResolutionQueueManager
    .getStepsForPlayer(args.gameId, args.playerId as any)
    .find((step: any) =>
      step?.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT
      && String(step?.costType || '') === 'pay_life'
      && step?.[CYCLING_PAY_LIFE_FLAG] === true
      && String(step?.sourceId || step?.cardId || '') === String(args.cardId));
  if (existing) return true;

  const name = String(args.card?.name || 'Card');
  const imageUrl = args.card?.image_uris?.small || args.card?.image_uris?.normal;
  ResolutionQueueManager.addStep(args.gameId, {
    type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
    playerId: args.playerId as any,
    sourceId: args.cardId,
    sourceName: name,
    sourceImage: imageUrl,
    description: `Pay ${amount} life to cycle ${name}.`,
    mandatory: true,
    cardId: args.cardId,
    cardName: name,
    costType: 'pay_life',
    amount,
    title: `Pay ${amount} life to cycle ${name}`,
    imageUrl,
    availableCards: [],
    availableTargets: [],
    canCancel: true,
    allowCancel: true,
    [CYCLING_PAY_LIFE_FLAG]: true,
    cyclingActivationArgs: {
      cardId: args.cardId,
      abilityId: args.abilityId,
      xValue: args.xValue,
    },
  } as any);
  return true;
}

export function completeCyclingAfterCostPaid(args: {
  io: Server;
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  abilityId?: string;
  cyclingDefinition: CyclingActivationDefinition;
  xValue?: number;
  costPaidLabel?: string;
}): boolean {
  const { io, game, gameId, playerId, cardId, cyclingDefinition } = args;
  const zones = (game.state as any)?.zones?.[playerId];
  const hand = Array.isArray(zones?.hand) ? zones.hand : [];
  const handIndex = hand.findIndex((card: any) => String(card?.id || '') === String(cardId));
  if (handIndex === -1) return false;

  const card = hand[handIndex];
  const cardName = String(card?.name || args.cyclingDefinition.keywordLabel || 'Card');
  const normalizedAbilityId = String(args.abilityId || 'cycling');
  const cyclingXValue = typeof args.xValue === 'number' && Number.isFinite(args.xValue)
    ? Math.max(0, Math.floor(args.xValue))
    : undefined;
  const costPaidLabel = String(args.costPaidLabel || cyclingDefinition.cost || '').trim();

  if (costPaidLabel) {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)} paid ${costPaidLabel} to activate ${cyclingDefinition.keywordLabel} on ${cardName}.`,
      ts: Date.now(),
    });
  }

  zones.hand.splice(handIndex, 1);
  zones.graveyard = zones.graveyard || [];
  const cyclingCtx = {
    state: game.state,
    libraries: (game as any).libraries,
    bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
    rng: (game as any).rng,
    gameId,
  } as any;
  pushCardToPlayerGraveyardWithReplacements(cyclingCtx, String(playerId), card, zones.graveyard);
  zones.handCount = zones.hand.length;
  zones.graveyardCount = zones.graveyard.length;

  game.state.stack = game.state.stack || [];
  const abilityStackId = `ability_cycling_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  game.state.stack.push({
    id: abilityStackId,
    type: 'ability',
    controller: playerId,
    source: cardId,
    sourceName: cardName,
    description: cyclingDefinition.stackDescription,
    abilityType: cyclingDefinition.kind,
    abilityId: normalizedAbilityId,
    cardId,
    cardName,
    searchCriteria: cyclingDefinition.searchCriteria,
    searchFilter: cyclingDefinition.searchFilter,
    ...(typeof cyclingXValue === "number" ? { xValue: cyclingXValue } : null),
  } as any);

  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, playerId)} activated ${cyclingDefinition.keywordLabel} on ${cardName} (on the stack).`,
    ts: Date.now(),
  });

  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }

  appendEvent(gameId, (game.state as any).seq ?? 0, "activateCycling", {
    playerId,
    cardId,
    cardName,
    abilityId: normalizedAbilityId,
    cyclingCost: costPaidLabel || cyclingDefinition.cost,
    ...(typeof cyclingXValue === "number" ? { xValue: cyclingXValue } : null),
    stackId: abilityStackId,
    stackAbilityType: cyclingDefinition.kind,
    stackDescription: cyclingDefinition.stackDescription,
    searchCriteria: cyclingDefinition.searchCriteria,
    searchFilter: cyclingDefinition.searchFilter,
  });

  const cycledCardSnapshot = { ...card };
  queueCycleTriggeredAbilities(cyclingCtx, String(playerId), cycledCardSnapshot, { xValue: cyclingXValue });
  queueDiscardTriggeredAbilities(cyclingCtx, String(playerId), [cycledCardSnapshot], { fromCycling: true });
  return true;
}

export async function tryResumeCyclingAfterPayLife(
  io: Server,
  game: any,
  gameId: string,
  playerId: string,
  step: any,
  cyclingDefinition: CyclingActivationDefinition,
): Promise<boolean> {
  const args = step?.cyclingActivationArgs && typeof step.cyclingActivationArgs === 'object'
    ? step.cyclingActivationArgs
    : {};
  const amount = Math.max(1, Math.floor(Number(step?.amount || 0)));
  const completed = completeCyclingAfterCostPaid({
    io,
    game,
    gameId,
    playerId,
    cardId: String(args.cardId || step?.cardId || step?.sourceId || ''),
    abilityId: String(args.abilityId || 'cycling'),
    cyclingDefinition,
    xValue: typeof args.xValue === 'number' ? args.xValue : undefined,
    costPaidLabel: amount ? `Pay ${amount} life` : cyclingDefinition.cost,
  });
  if (completed) broadcastGame(io, game, gameId);
  return completed;
}
