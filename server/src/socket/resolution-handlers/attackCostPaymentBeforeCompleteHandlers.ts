/**
 * socket/resolution-handlers/attackCostPaymentBeforeCompleteHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (submitResolutionResponse).
 * Cluster moved: processAttackCostPaymentBeforeStepComplete (Ghostly Prison / Propaganda
 * attack-tax payment that must commit declare-attackers before the step is consumed).
 * Public entry symbols: processAttackCostPaymentBeforeStepComplete.
 *
 * Must not import resolution.ts.
 */

import type { Server, Socket } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { debug, debugError } from "../../utils/debug.js";
import { executeDeclareAttackers } from "../combat.js";
import {
  broadcastManaPoolUpdate,
  getOrInitManaPool,
  getPlayerName,
  payGenericManaWithAvailableSources,
  refundGenericManaPayment,
} from "../util.js";

/** Attack-tax: pay then execute declare-attackers; refund and keep the step on failure. */
/**
 * Attack-tax prompts must commit the declare-attackers action before the resolution
 * step is consumed. If declaration fails after payment, refund mana and keep the step.
 */
export async function processAttackCostPaymentBeforeStepComplete(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
  socket: Socket,
): Promise<'not_applicable' | 'abort' | 'continue'> {
  const stepData = step as any;
  if (stepData?.attackCostPayment !== true) {
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

  if (response.cancelled || choiceId === 'cancel_attack') {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, controllerId)} declined to pay the attack cost.`,
      ts: Date.now(),
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return 'continue';
  }

  if (!choiceId) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Missing attack cost choice.' });
    return 'abort';
  }

  if (choiceId !== 'pay_attack_cost') {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Unexpected attack cost choice.' });
    return 'abort';
  }

  const amount = Number(stepData.attackCostAmount || 0) || 0;
  const attackers = Array.isArray(stepData.attackers) ? stepData.attackers : [];
  const breakdown = Array.isArray(stepData.attackCostBreakdown) ? stepData.attackCostBreakdown : [];

  if (attackers.length === 0) {
    socket.emit('error', {
      code: 'DECLARE_ATTACKERS_ERROR',
      message: 'Attack cost payment step is missing attacker data.',
    });
    return 'abort';
  }

  const payment = payGenericManaWithAvailableSources(game.state, controllerId, amount, {
    excludedPermanentIds: attackers.map((entry: any) => String(entry?.creatureId || '')).filter(Boolean),
  });
  if (!payment.ok) {
    socket.emit('error', {
      code: 'INSUFFICIENT_MANA',
      message: payment.error || 'Insufficient mana.',
    });
    return 'abort';
  }

  try {
    debug(1, `[combat] Player ${controllerId} paid {${amount}} to attack (${breakdown.map((entry: any) => entry.sources.join(', ')).join('; ')})`);
    broadcastManaPoolUpdate(io, gameId, controllerId, getOrInitManaPool(game.state, controllerId) as any, 'Paid attack cost', game);

    await executeDeclareAttackers(io, gameId, controllerId as any, attackers, {
      attackCostPaid: true,
      attackCostAmount: amount,
      attackCostBreakdown: breakdown,
      attackCostTappedPermanents: payment.tappedPermanents,
      attackCostSacrificedPermanents: payment.sacrificedPermanents,
      attackCostPaymentManaDelta: payment.paymentManaDelta,
    });
    return 'continue';
  } catch (err: any) {
    refundGenericManaPayment(game.state, controllerId, payment);
    broadcastManaPoolUpdate(io, gameId, controllerId, getOrInitManaPool(game.state, controllerId) as any, 'Refunded attack cost', game);
    debugError(1, `[Resolution] attackCostPayment failed:`, err);
    socket.emit('error', {
      code: err?.code || 'DECLARE_ATTACKERS_ERROR',
      message: err?.message ?? String(err),
    });
    return 'abort';
  }
}
