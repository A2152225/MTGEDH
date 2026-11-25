// server/src/socket/game-actions-handlers/payCastSpellAdditionalLifeCost.ts
// Shared inline pay-life additional-cost payment for requestCastSpell paths.
// Routes through payLifeAmount so Karn's Sylex (and Ashiok) apply. Public:
// tryPayInlineCastAdditionalLifeCost.

import type { Server } from "socket.io";
import { reportHookFailure } from '../../../../shared/src/hookFailureReporter.js';
import type { GameContext } from "../../state/context.js";
import { canPlayerPayLife } from "../../state/modules/game-state-effects-handlers/gameStateEffectsLifeModifierOraclePatterns.js";
import { canPayLifeAmount, payLifeAmount } from "../../state/modules/batch97PayLife.js";
import { queueLifePaymentTriggers } from "../../state/modules/triggers/pay-life.js";
import { getPlayerName } from "../util.js";

export function tryPayInlineCastAdditionalLifeCost(params: {
  io: Server;
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  cardName: string;
  amount: number;
  card: any;
  effectId?: string;
  emitError: (payload: { code: string; message: string }) => void;
}): boolean {
  const { io, game, gameId, playerId, cardId, cardName, card, effectId, emitError } = params;
  const amount = Math.max(0, Math.floor(Number(params.amount) || 0));
  const startingLife = game.state.startingLife || 40;
  const currentLife = game.state.life?.[playerId] ?? startingLife;
  const payOpts = { forSpellOrNonManaAbility: true as const };

  if (!canPlayerPayLife(game as GameContext, String(playerId)) || !canPayLifeAmount(game.state, String(playerId), amount, payOpts)) {
    if (effectId) delete (game.state as any).pendingSpellCasts?.[effectId];
    emitError({
      code: 'CANNOT_PAY_COST',
      message: `Cannot cast ${cardName}: players can't pay life.`,
    });
    return false;
  }
  if (currentLife < amount) {
    if (effectId) delete (game.state as any).pendingSpellCasts?.[effectId];
    emitError({
      code: 'CANNOT_PAY_COST',
      message: `Cannot cast ${cardName}: You need to pay ${amount} life but only have ${currentLife} life.`,
    });
    return false;
  }

  const paid = payLifeAmount(game.state, String(playerId), amount, {
    forSpellOrNonManaAbility: true,
    skipReplacementOrder: true,
    ctx: { state: game.state, gameId, isReplaying: Boolean((game as any).isReplaying) },
  });
  if (!paid.paid && !paid.replaced) {
    if (effectId) delete (game.state as any).pendingSpellCasts?.[effectId];
    emitError({
      code: 'CANNOT_PAY_COST',
      message: `Cannot cast ${cardName}: players can't pay life.`,
    });
    return false;
  }

  if (!paid.replaced) {
    try {
      (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
      (game.state as any).lifeLostThisTurn[String(playerId)] =
        ((game.state as any).lifeLostThisTurn[String(playerId)] || 0) + amount;
    } catch (err) { reportHookFailure('payment.lifeLostTracking', err, { source: 'payCastSpellAdditionalLifeCost' }); /* tracking is best-effort */ }
    try {
      queueLifePaymentTriggers(game as any, String(playerId), amount, { sourceId: cardId, sourceName: cardName });
    } catch (err) { reportHookFailure('trigger.best-effort', err, { source: 'payCastSpellAdditionalLifeCost' }); /* triggers are best-effort */ }
  }

  if (card && typeof card === 'object') {
    card.additionalCostPaid = true;
    card.additionalCostMethod = 'pay_life';
  }
  const pendingCast = effectId ? (game.state as any).pendingSpellCasts?.[effectId] : undefined;
  if (pendingCast) {
    pendingCast.additionalCostPaid = true;
    pendingCast.additionalCostMethod = 'pay_life';
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, playerId)} pays ${amount} life to cast ${cardName}. (${currentLife} -> ${game.state.life[playerId]})`,
    ts: Date.now(),
  });
  return true;
}
