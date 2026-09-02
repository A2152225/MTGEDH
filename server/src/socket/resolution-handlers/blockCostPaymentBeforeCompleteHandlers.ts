/**
 * socket/resolution-handlers/blockCostPaymentBeforeCompleteHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (submitResolutionResponse).
 * Cluster: processBlockCostPaymentBeforeStepComplete (Archangel of Tithes
 * block-tax payment that must commit declare-blockers before the step is consumed).
 * Public entry symbols: processBlockCostPaymentBeforeStepComplete.
 *
 * Must not import resolution.ts.
 */

import type { Server, Socket } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { debug, debugError } from "../../utils/debug.js";
import { executeDeclareBlockers } from "../combat-handlers/combatDeclareBlockersRequest.js";
import {
  broadcastManaPoolUpdate,
  getOrInitManaPool,
  getPlayerName,
  payGenericManaWithAvailableSources,
  refundGenericManaPayment,
} from "../util.js";

/**
 * Block-tax prompts must commit the declare-blockers action before the resolution
 * step is consumed. If declaration fails after payment, refund mana and keep the step.
 */
export async function processBlockCostPaymentBeforeStepComplete(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
  socket: Socket,
): Promise<'not_applicable' | 'abort' | 'continue'> {
  const stepData = step as any;
  if (stepData?.blockCostPayment !== true) {
    return 'not_applicable';
  }

  const extractId = (sel: any): string | null => {
    if (typeof sel === 'string') return sel;
    if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
    if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
    return null;
  };

  const controllerId = String(response.playerId);
  const choiceId = extractId(response.selections);

  if (response.cancelled || choiceId === 'cancel_block') {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, controllerId)} declined to pay the block cost.`,
      ts: Date.now(),
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return 'continue';
  }

  if (!choiceId) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Missing block cost choice.' });
    return 'abort';
  }

  if (choiceId !== 'pay_block_cost') {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Unexpected block cost choice.' });
    return 'abort';
  }

  const amount = Number(stepData.blockCostAmount || 0) || 0;
  const lifeAmount = Number(stepData.blockCostLifeAmount || 0) || 0;
  const blockers = Array.isArray(stepData.blockers) ? stepData.blockers : [];
  const sources = Array.isArray(stepData.blockCostSources) ? stepData.blockCostSources : [];

  if (blockers.length === 0) {
    socket.emit('error', {
      code: 'DECLARE_BLOCKERS_ERROR',
      message: 'Block cost payment step is missing blocker data.',
    });
    return 'abort';
  }

  const payment = amount > 0
    ? payGenericManaWithAvailableSources(game.state, controllerId, amount, {
        excludedPermanentIds: blockers.map((entry: any) => String(entry?.blockerId || '')).filter(Boolean),
      })
    : { ok: true, tappedPermanents: [], sacrificedPermanents: [], paymentManaDelta: {} as Record<string, number> };
  if (!payment.ok) {
    socket.emit('error', {
      code: 'INSUFFICIENT_MANA',
      message: payment.error || 'Insufficient mana.',
    });
    return 'abort';
  }

  let lifePaid = 0;
  if (lifeAmount > 0) {
    const playerLife = Number(
      game.state?.life?.[controllerId]
      ?? (game.state?.players || []).find((entry: any) => String(entry?.id || '') === controllerId)?.life
      ?? 40,
    );
    if (playerLife <= lifeAmount) {
      if (amount > 0) refundGenericManaPayment(game.state, controllerId, payment);
      socket.emit('error', {
        code: 'INSUFFICIENT_LIFE',
        message: `Cannot pay ${lifeAmount} life.`,
      });
      return 'abort';
    }
    game.state.life = game.state.life || {};
    game.state.life[controllerId] = playerLife - lifeAmount;
    const playerObj = (game.state.players || []).find((entry: any) => String(entry?.id || '') === controllerId);
    if (playerObj) playerObj.life = game.state.life[controllerId];
    lifePaid = lifeAmount;
  }

  try {
    debug(1, `[combat] Player ${controllerId} paid {${amount}}${lifePaid ? ` and ${lifePaid} life` : ''} to block (${sources.join(', ')})`);
    broadcastManaPoolUpdate(io, gameId, controllerId, getOrInitManaPool(game.state, controllerId) as any, 'Paid block cost', game);

    await executeDeclareBlockers(io, gameId, controllerId as any, blockers, {
      blockCostPaid: true,
      blockCostAmount: amount,
      blockCostSources: sources,
      blockCostTappedPermanents: payment.tappedPermanents,
      blockCostSacrificedPermanents: payment.sacrificedPermanents,
      blockCostPaymentManaDelta: payment.paymentManaDelta,
    });
    return 'continue';
  } catch (err: any) {
    refundGenericManaPayment(game.state, controllerId, payment);
    broadcastManaPoolUpdate(io, gameId, controllerId, getOrInitManaPool(game.state, controllerId) as any, 'Refunded block cost', game);
    debugError(1, `[Resolution] blockCostPayment failed:`, err);
    socket.emit('error', {
      code: err?.code || 'DECLARE_BLOCKERS_ERROR',
      message: err?.message ?? String(err),
    });
    return 'abort';
  }
}
