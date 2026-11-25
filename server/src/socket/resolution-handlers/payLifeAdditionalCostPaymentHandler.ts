// server/src/socket/resolution-handlers/payLifeAdditionalCostPaymentHandler.ts
// Handle ADDITIONAL_COST_PAYMENT when costType is pay_life: confirm via
// AdditionalCostModal, pay through payLifeAmount, and either resume the cast
// or stamp a CR 616.1 order continuation. Cancel backs out of the cast.
// Public: tryHandlePayLifeAdditionalCostPayment, resumeCastAfterResolvedPayLifeCost.

import type { Server } from "socket.io";
import { reportHookFailure } from '../../../../shared/src/hookFailureReporter.js';
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { payLifeAmount } from "../../state/modules/batch97PayLife.js";
import { queueLifePaymentTriggers } from "../../state/modules/triggers/pay-life.js";
import { debugWarn } from "../../utils/debug.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";
import { resumePlayerCastSpellFromHand } from "../resolutionSyntheticCastSocketUtils.js";
import {
  PAY_LIFE_COST_RESOLVED_MARKER,
  stampPayLifeOrderCastContinuation,
} from "../game-actions-handlers/gameActionsPayLifeAdditionalCostPrompt.js";
import { declineCastFromExileToGraveyard } from "../game-actions-handlers/declineCastFromExileToGraveyard.js";
import { CYCLING_PAY_LIFE_FLAG, tryResumeCyclingAfterPayLife } from "../interaction-handlers/cyclingPayLifeCost.js";
import { getCyclingDefinitionForActivation } from "../interaction-handlers/interactionCyclingActivationDefinitions.js";
import { cardHasPrintedCycling, getGrantedCyclingCost } from "../../state/modules/handCyclingGrants.js";

export async function resumeCastAfterResolvedPayLifeCost(
  io: Server,
  game: any,
  gameId: string,
  playerId: string,
  castArgs: any,
  extra: { replaced?: boolean } = {},
): Promise<void> {
  if (!castArgs || !castArgs.cardId) return;
  const basePayment = Array.isArray(castArgs.payment) ? castArgs.payment : [];
  const payment = basePayment.filter((item: any) => item && (item.permanentId || item.mana || item.paymentSourceId));
  const baseTargets = (castArgs.targets && typeof castArgs.targets === 'object' && !Array.isArray(castArgs.targets))
    ? { ...castArgs.targets }
    : {};
  const pendingCasts = (game.state as any).pendingSpellCasts;
  const resumeCardId = String(castArgs.cardId);
  if (pendingCasts && typeof pendingCasts === 'object') {
    for (const [pendingId, pendingCast] of Object.entries(pendingCasts)) {
      if (pendingCast && String((pendingCast as any).cardId || '') === resumeCardId) {
        delete pendingCasts[pendingId];
      }
    }
  }

  await resumePlayerCastSpellFromHand(io, gameId, String(playerId), {
    cardId: resumeCardId,
    skipPriorityCheck: true,
    targets: {
      ...baseTargets,
      additionalCostPaid: true,
      additionalCostMethod: 'pay_life',
      [PAY_LIFE_COST_RESOLVED_MARKER]: true,
      payLifeReplaced: extra.replaced === true,
    },
    payment,
    xValue: castArgs.xValue,
    alternateCostId: castArgs.alternateCostId,
    convokeTappedCreatures: castArgs.convokeTappedCreatures,
  });
}

export async function tryHandlePayLifeAdditionalCostPayment(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepData = step as any;
  if (String(stepData.costType || '') !== 'pay_life') return false;

  const playerId = String(response.playerId || '').trim();
  const amount = Math.max(1, Math.floor(Number(stepData.amount || 0)));
  const cardName = String(stepData.cardName || stepData.sourceName || 'Spell');

  if (response.cancelled) {
    try {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, playerId)} cancelled paying ${amount} life for ${cardName}.`,
        ts: Date.now(),
      });
    } catch { /* chat is best-effort */ }
    const declineMadness = stepData.declineMadnessOnCancel === true
      || String(stepData.castSpellFromHandArgs?.alternateCostId || stepData.castFromExileForcedAlternateCostId || '') === 'madness';
    if (declineMadness) {
      declineCastFromExileToGraveyard(
        game,
        playerId,
        String(stepData.cardId || stepData.sourceId || stepData.castSpellFromHandArgs?.cardId || ''),
      );
    }
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  const paid = payLifeAmount(game.state, playerId, amount, {
      forSpellOrNonManaAbility: true,
    ctx: { state: game.state, gameId, isReplaying: Boolean((game as any).isReplaying) },
  });

  if (paid.pendingReplacementOrder) {
    const stamped = stampPayLifeOrderCastContinuation({
      game,
      gameId,
      playerId,
      amount,
      continuation: (stepData.castSpellFromHandArgs && typeof stepData.castSpellFromHandArgs === 'object')
        ? stepData.castSpellFromHandArgs
        : { cardId: stepData.cardId, payment: undefined },
    });
    if (!stamped) {
      debugWarn(1, '[Resolution] pay-life order queued but no order step found to stamp continuation');
    }
    broadcastGame(io, game, gameId);
    return true;
  }

  if (!paid.paid && !paid.replaced) {
    emitToPlayer(io, playerId as any, 'error', {
      code: 'CANNOT_PAY_COST',
      message: `Cannot pay ${amount} life to ${stepData[CYCLING_PAY_LIFE_FLAG] ? 'cycle' : 'cast'} ${cardName}.`,
    });
    return true;
  }

  if (!paid.replaced) {
    try {
      (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
      (game.state as any).lifeLostThisTurn[playerId] =
        ((game.state as any).lifeLostThisTurn[playerId] || 0) + amount;
    } catch (err) { reportHookFailure('payment.lifeLostTracking', err, { source: 'payLifeAdditionalCostPaymentHandler' }); /* tracking is best-effort */ }
    try {
      queueLifePaymentTriggers(game as any, playerId, amount, {
        sourceId: String(stepData.cardId || stepData.sourceId || ''),
        sourceName: cardName,
      });
    } catch (err) { reportHookFailure('trigger.best-effort', err, { source: 'payLifeAdditionalCostPaymentHandler' }); /* triggers are best-effort */ }
  }

  const paidCardId = String(stepData.cardId || stepData.sourceId || stepData.castSpellFromHandArgs?.cardId || '');
  const zones = (game.state as any)?.zones || {};
  const hand = Array.isArray(zones?.[playerId]?.hand) ? zones[playerId].hand : [];
  const exile = Array.isArray(zones?.[playerId]?.exile) ? zones[playerId].exile : [];
  const paidCard = hand.find((card: any) => String(card?.id || '') === paidCardId)
    || exile.find((card: any) => String(card?.id || '') === paidCardId)
    || Object.values(zones).flatMap((zone: any) => Array.isArray(zone?.exile) ? zone.exile : []).find((card: any) => String(card?.id || '') === paidCardId);
  if (paidCard) {
    paidCard.payLifeAdditionalCostResolved = true;
    paidCard.additionalCostPaid = true;
    paidCard.additionalCostMethod = 'pay_life';
  }

  if (stepData[CYCLING_PAY_LIFE_FLAG] === true || stepData.cyclingActivationArgs) {
    const cardId = String(stepData.cyclingActivationArgs?.cardId || stepData.cardId || stepData.sourceId || '');
    const zones = (game.state as any)?.zones || {};
    const hand = Array.isArray(zones?.[playerId]?.hand) ? zones[playerId].hand : [];
    const card = hand.find((entry: any) => String(entry?.id || '') === cardId);
    const oracleText = String(card?.oracle_text || '');
    const abilityId = String(stepData.cyclingActivationArgs?.abilityId || 'cycling');
    let definition = getCyclingDefinitionForActivation(oracleText, abilityId, cardId);
    if (!definition && card && !cardHasPrintedCycling(card)) {
      const grantedCost = getGrantedCyclingCost(game.state, playerId, card);
      if (grantedCost) {
        definition = { kind: 'cycling', keywordLabel: 'Cycling', cost: grantedCost, stackDescription: 'Draw a card' };
      }
    }
    if (definition) {
      await tryResumeCyclingAfterPayLife(io, game, gameId, playerId, stepData, definition);
      return true;
    }
  }

  await resumeCastAfterResolvedPayLifeCost(io, game, gameId, playerId, stepData.castSpellFromHandArgs, {
    replaced: paid.replaced === true,
  });
  broadcastGame(io, game, gameId);
  return true;
}
