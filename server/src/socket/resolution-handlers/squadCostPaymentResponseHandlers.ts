/**
 * socket/resolution-handlers/squadCostPaymentResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse switch).
 * Cluster moved: the SQUAD_COST_PAYMENT case - record how many times squad was paid on the pending
 * cast, then either restart the gated requestCastSpell or resume castSpellFromHand with an
 * additional-cost-paid marker.
 * Public entry symbols: handleSquadCostPaymentResponse.
 *
 * Terminal for the case: every original `break` becomes `return`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { requestCastSpellForSocket } from "../game-actions.js";
import {
  appendCastSpellContinuationEvent,
  createForwardingGameActionSocket,
  resumePlayerCastSpellFromHand,
} from "../resolutionSyntheticCastSocketUtils.js";
import { emitToPlayer, getPlayerName } from "../util.js";

/** SQUAD_COST_PAYMENT: stamp the squad multiplier on the pending cast and resume it. */
export async function handleSquadCostPaymentResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const stepData = step as any;
  if (response.cancelled) return;

  const castArgs = stepData.castSpellFromHandArgs as any;
  const cardId = String(stepData.cardId || stepData.sourceId || castArgs?.cardId || '');
  const cardName = String(stepData.cardName || stepData.sourceName || 'Spell');

  let timesPaid = 0;
  if (typeof response.selections === 'number') timesPaid = response.selections;
  else if (typeof response.selections === 'string') timesPaid = Number(response.selections);
  else if (Array.isArray(response.selections) && response.selections.length > 0) timesPaid = Number(response.selections[0]);
  else if (response.selections && typeof response.selections === 'object' && (response.selections as any).timesPaid != null) {
    timesPaid = Number((response.selections as any).timesPaid);
  }
  timesPaid = Number.isFinite(timesPaid) ? Math.max(0, Math.floor(timesPaid)) : 0;

  const zones = (game.state as any)?.zones?.[pid];
  if (!zones) {
    emitToPlayer(io, pid as any, 'error', { code: 'NO_ZONES', message: 'Player zones not found' });
    return;
  }

  const requestCastEffectId = String(stepData.effectId || stepData.sourceId || '').trim();
  const requestCastPending = requestCastEffectId
    ? (game.state as any)?.pendingSpellCasts?.[requestCastEffectId]
    : undefined;

  const sourceZoneRaw = String(castArgs?.fromZone || requestCastPending?.fromZone || 'hand').toLowerCase().trim();
  const spellSourceZone = sourceZoneRaw === 'exile'
    || sourceZoneRaw === 'graveyard'
    || sourceZoneRaw === 'library'
    || sourceZoneRaw === 'command'
    ? sourceZoneRaw
    : 'hand';

  const hand = Array.isArray((zones as any).hand) ? ((zones as any).hand as any[]) : [];
  const exile = Array.isArray((zones as any).exile) ? ((zones as any).exile as any[]) : [];
  const graveyard = Array.isArray((zones as any).graveyard) ? ((zones as any).graveyard as any[]) : [];
  const library = Array.isArray((game as any).libraries?.get?.(String(pid)))
    ? ((game as any).libraries.get(String(pid)) as any[])
    : (Array.isArray((zones as any).library) ? ((zones as any).library as any[]) : []);
  const command = Array.isArray((game.state as any)?.commandZone?.[String(pid)]?.commanderCards)
    ? ((game.state as any).commandZone[String(pid)].commanderCards as any[])
    : [];

  const sourceCards = spellSourceZone === 'exile'
    ? exile
    : spellSourceZone === 'graveyard'
      ? graveyard
      : spellSourceZone === 'library'
        ? library
        : spellSourceZone === 'command'
          ? command
          : hand;

  const cardInHand = hand.find((c: any) => c && c.id === cardId);
  const spellCard = cardInHand || sourceCards.find((c: any) => c && c.id === cardId);
  if (!spellCard) {
    emitToPlayer(io, pid as any, 'error', {
      code: spellSourceZone === 'hand' ? 'CARD_NOT_IN_HAND' : 'CARD_NOT_FOUND',
      message: spellSourceZone === 'hand' ? 'Card not found in hand' : `Card not found in ${spellSourceZone}`,
    });
    return;
  }

  (spellCard as any).squadTimesPaid = timesPaid;
  (spellCard as any).additionalCostPaid = true;
  (spellCard as any).additionalCostMethod = 'squad';
  if (requestCastPending) {
    requestCastPending.squadTimesPaid = timesPaid;
    requestCastPending.additionalCostPaid = true;
    requestCastPending.additionalCostMethod = 'squad';
  }

  appendCastSpellContinuationEvent(gameId, game, {
    playerId: pid,
    resolvedStepId: String((step as any).id || ''),
    resolvedStepType: String((step as any).type || ''),
    cardId,
    ...(spellSourceZone === 'hand'
      ? {
          cardUpdates: {
            squadTimesPaid: timesPaid,
            additionalCostPaid: true,
          },
        }
      : {}),
    ...(requestCastPending
      ? {
          effectId: requestCastEffectId,
          pendingSpellCast: {
            ...(requestCastPending || {}),
            squadTimesPaid: timesPaid,
            additionalCostPaid: true,
            additionalCostMethod: 'squad',
          },
        }
      : {}),
  });

  if (timesPaid > 0) {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} pays the squad cost ${timesPaid} time(s) for ${cardName}.`,
      ts: Date.now(),
    });
  }

  const shouldRestartRequestCast = Boolean(requestCastPending && requestCastEffectId)
    || castArgs?.skipPriorityCheck === true;

  if (shouldRestartRequestCast) {
    if (requestCastPending && requestCastEffectId) {
      delete (game.state as any).pendingSpellCasts[requestCastEffectId];
    }
    const { socket: restartCastSocket } = createForwardingGameActionSocket(io, gameId, String(pid));
    await requestCastSpellForSocket(
      io,
      restartCastSocket as any,
      {
        gameId,
        cardId,
        faceIndex: Number.isFinite(castArgs?.faceIndex)
          ? Number(castArgs.faceIndex)
          : (Number.isFinite(requestCastPending?.faceIndex) ? Number(requestCastPending.faceIndex) : undefined),
        fromZone: spellSourceZone as any,
      },
      {
        skipPriorityCheck: true,
        xValue: Number.isFinite(castArgs?.xValue)
          ? Number(castArgs.xValue)
          : (Number.isFinite(requestCastPending?.xValue) ? Number(requestCastPending.xValue) : undefined),
        forcedAlternateCostId: String(castArgs?.alternateCostId || requestCastPending?.forcedAlternateCostId || '').trim() || undefined,
        castWithoutPayingManaCost: castArgs?.castWithoutPayingManaCost === true || requestCastPending?.castWithoutPayingManaCost === true,
        bypassExilePermissionCheck: castArgs?.bypassExilePermissionCheck === true || requestCastPending?.bypassExilePermissionCheck === true,
        ignoreTimingRestrictions: castArgs?.ignoreTimingRestrictions === true || requestCastPending?.ignoreTimingRestrictions === true,
      },
    );
    return;
  }

  const basePayment = Array.isArray(castArgs?.payment) ? castArgs.payment : [];
  const alreadyMarked = basePayment.some((p: any) => p && p.additionalCostPaid === true);
  const paymentWithMarker = alreadyMarked ? basePayment : [...basePayment, { additionalCostPaid: true }];

  await resumePlayerCastSpellFromHand(io, gameId, String(pid), {
    cardId,
    payment: paymentWithMarker,
    targets: castArgs?.targets,
    xValue: castArgs?.xValue,
    alternateCostId: castArgs?.alternateCostId,
    convokeTappedCreatures: castArgs?.convokeTappedCreatures,
  });
}
