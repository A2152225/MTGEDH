/**
 * socket/resolutionOptionChoicePayLifeReplacementOrderHandlers.ts
 *
 * Origin parent: optionChoiceResponseHandlers (CR 616.1 pay-life order).
 * Public: tryHandlePayLifeReplacementOrderChoice.
 * Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../state/resolution/index.js";
import { appendEvent } from "../db/index.js";
import { applyAshiokLifePayExile } from "../state/modules/batch96LifePayExile.js";
import { payLifeAmount } from "../state/modules/batch97PayLife.js";
import {
  PAY_LIFE_REPLACEMENT_ORDER_FLAG,
  applyChosenPayLifeReplacement,
  listPayLifeReplacementCandidates,
  type PayLifeReplacementCandidate,
} from "../state/modules/payLifeReplacementOrder.js";
import { debugWarn } from "../utils/debug.js";
import { broadcastGame, emitToPlayer } from "./util.js";

function extractId(sel: any): string | null {
  if (typeof sel === 'string') return sel;
  if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
  if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
  return null;
}

function applyOne(state: any, playerId: string, amount: number, candidate: PayLifeReplacementCandidate): boolean {
  if (candidate.effectId === 'pay-life-exile-library-top') {
    const applied = applyAshiokLifePayExile(state, playerId, amount);
    return Boolean(applied?.replaced);
  }
  return false;
}

export async function tryHandlePayLifeReplacementOrderChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepData = step as any;
  if (stepData[PAY_LIFE_REPLACEMENT_ORDER_FLAG] !== true && stepData.payLifeReplacementOrderChoice !== true) {
    return false;
  }

  const playerId = String(response.playerId || stepData.payLifePlayerId || '').trim();
  const amount = Math.max(0, Math.floor(Number(stepData.payLifeAmount || 0)));
  const chosenId = String(extractId(response.selections) || '').trim();
  if (!playerId || !chosenId) {
    emitToPlayer(io, (response.playerId || playerId) as any, 'error', {
      code: 'PAY_LIFE_REPLACEMENT_ORDER_FAILED',
      message: 'Unable to apply the life-payment replacement order.',
    });
    return true;
  }

  const state = game.state;
  let replaced = false;
  const first = applyChosenPayLifeReplacement({
    state,
    playerId,
    amount,
    chosenId,
    applyCandidate: (candidate) => {
      if (applyOne(state, playerId, amount, candidate)) replaced = true;
    },
  });

  if (!replaced) {
    for (const candidate of first.remaining) {
      if (applyOne(state, playerId, amount, candidate)) {
        replaced = true;
        break;
      }
    }
  }

  if (!replaced) {
    // No replacement fully replaced the payment; pay the life through the chokepoint,
    // passing an empty chosen list so we do not re-queue this prompt.
    payLifeAmount(state, playerId, amount, { skipReplacementOrder: true, alreadyAppliedEffectIds: [
      first.chosen?.effectId,
      ...first.remaining.map((c) => c.effectId),
    ].filter(Boolean) as string[] });
  }

  try {
    await appendEvent(gameId, (game as any).seq ?? 0, 'payLifeReplacementOrderResolve', {
      playerId,
      amount,
      chosenId,
      replaced,
      resolvedStepId: String((step as any).id || '').trim(),
    });
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist payLifeReplacementOrderResolve event:', err);
  }

  const castArgs = stepData.castSpellFromHandArgs;
  if (castArgs && typeof castArgs === 'object' && castArgs.cardId) {
    const { resumeCastAfterResolvedPayLifeCost } = await import('./resolution-handlers/payLifeAdditionalCostPaymentHandler.js');
    await resumeCastAfterResolvedPayLifeCost(io, game, gameId, playerId, castArgs, { replaced });
  }

  broadcastGame(io, game, gameId);
  return true;
}
