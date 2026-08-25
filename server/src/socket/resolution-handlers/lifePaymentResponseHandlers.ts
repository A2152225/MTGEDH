/**
 * socket/resolution-handlers/lifePaymentResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse switch).
 * Cluster moved: LIFE_PAYMENT case body (pay-life prompts that gate a pending cast).
 * Public entry symbols: handleLifePaymentResponse.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { queueLifePaymentTriggers } from "../../state/modules/triggers/pay-life.js";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { validateLifePayment } from "../../state/utils.js";
import {
  appendCastSpellContinuationEvent,
  resumePlayerCastSpellFromHand,
} from "../resolutionSyntheticCastSocketUtils.js";
import { emitToPlayer, getPlayerName } from "../util.js";

/** LIFE_PAYMENT: pay the chosen amount of life, then resume the captured cast continuation. */
export async function handleLifePaymentResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const stepData = step as any;
  const cardId = String(stepData.cardId || stepData.sourceId || '');
  const cardName = String(stepData.cardName || stepData.sourceName || 'Spell');

  let lifePayment: number | null = null;
  if (typeof response.selections === 'number') {
    lifePayment = response.selections;
  } else if (typeof response.selections === 'string') {
    const n = Number(response.selections);
    lifePayment = Number.isFinite(n) ? n : null;
  } else if (Array.isArray(response.selections) && response.selections.length > 0) {
    const n = Number(response.selections[0]);
    lifePayment = Number.isFinite(n) ? n : null;
  } else if ((response.selections as any)?.lifePayment != null) {
    const n = Number((response.selections as any).lifePayment);
    lifePayment = Number.isFinite(n) ? n : null;
  }

  if (lifePayment == null) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_LIFE_PAYMENT',
      message: 'Invalid life payment',
    });
    return;
  }

  const startingLife = (game.state as any)?.startingLife || 40;
  const currentLife = (game.state as any)?.life?.[pid] ?? startingLife;
  const validationError = validateLifePayment(currentLife, lifePayment, cardName);
  if (validationError) {
    emitToPlayer(io, pid as any, 'error', { code: 'INVALID_LIFE_PAYMENT', message: validationError });
    return;
  }

  const zones = (game.state as any)?.zones?.[pid];
  if (!zones || !Array.isArray(zones.hand)) {
    emitToPlayer(io, pid as any, 'error', { code: 'NO_HAND', message: 'Hand not found' });
    return;
  }

  const cardInHand = (zones.hand as any[]).find((c: any) => c && c.id === cardId);
  if (!cardInHand) {
    emitToPlayer(io, pid as any, 'error', { code: 'CARD_NOT_IN_HAND', message: 'Card not found in hand' });
    return;
  }

  (cardInHand as any).lifePaymentAmount = lifePayment;

  (game.state as any).life = (game.state as any).life || {};
  (game.state as any).life[pid] = currentLife - lifePayment;

  // Track life lost this turn.
  try {
    (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
    (game.state as any).lifeLostThisTurn[String(pid)] =
      ((game.state as any).lifeLostThisTurn[String(pid)] || 0) + Number(lifePayment || 0);
  } catch {}
  queueLifePaymentTriggers(game as any, String(pid), Number(lifePayment || 0), { sourceId: cardId, sourceName: cardName });
  const playerObj = ((game.state as any).players || []).find((p: any) => p?.id === pid);
  if (playerObj) playerObj.life = (game.state as any).life[pid];

  appendCastSpellContinuationEvent(gameId, game, {
    playerId: pid,
    resolvedStepId: String((step as any).id || ''),
    resolvedStepType: String((step as any).type || ''),
    cardId,
    lifePaid: lifePayment,
    cardUpdates: {
      lifePaymentAmount: lifePayment,
    },
  });

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} pays ${lifePayment} life for ${cardName}. (${currentLife} → ${(game.state as any).life[pid]})`,
    ts: Date.now(),
  });

  // Continue the cast flow server-side using the original continuation args captured on the step.
  const castArgs = (stepData?.castSpellFromHandArgs || {}) as any;
  const basePayment = Array.isArray(castArgs.payment) ? castArgs.payment : [];
  const mergedPayment = [
    ...basePayment.filter((p: any) => !(p && typeof p === 'object' && 'lifePayment' in p)),
    { lifePayment },
  ];

  await resumePlayerCastSpellFromHand(io, gameId, String(pid), {
    cardId,
    payment: mergedPayment,
    targets: castArgs.targets,
    xValue: castArgs.xValue,
    alternateCostId: castArgs.alternateCostId,
    skipInteractivePrompts: castArgs.skipInteractivePrompts,
    convokeTappedCreatures: castArgs.convokeTappedCreatures,
  });
}
