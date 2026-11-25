// server/src/socket/resolution-handlers/breathstealerPayOrDiscardHandler.ts
// Complete Breathstealer's Crypt pay-or-discard after a revealed creature draw.
// Pay goes through payLifeAmount without forSpellOrNonManaAbility so Karn's
// Sylex does not block it. Public: tryHandleBreathstealerPayOrDiscard.

import type { Server } from "socket.io";
import { reportHookFailure } from '../../../../shared/src/hookFailureReporter.js';
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { payLifeAmount } from "../../state/modules/batch97PayLife.js";
import { BREATHSTEALER_PAY_OR_DISCARD_FLAG } from "../../state/modules/breathstealersCryptDrawReveal.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../../state/modules/graveyardEntryUtils.js";
import { queueLifePaymentTriggers } from "../../state/modules/triggers/pay-life.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";

function selectedAction(response: ResolutionStepResponse): string {
  const raw = Array.isArray(response.selections) ? response.selections[0] : response.selections;
  return String(raw || '').trim().toLowerCase();
}

function discardDrawnCard(game: any, gameId: string, playerId: string, cardId: string): boolean {
  const zones = (game.state as any)?.zones?.[playerId];
  const hand = Array.isArray(zones?.hand) ? zones.hand : [];
  const idx = hand.findIndex((card: any) => String(card?.id || '') === String(cardId));
  if (idx < 0) return false;
  const discarded = hand.splice(idx, 1)[0];
  zones.graveyard = zones.graveyard || [];
  const ctx = {
    state: game.state,
    libraries: (game as any).libraries,
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    rng: (game as any).rng,
    gameId,
  } as any;
  pushCardToPlayerGraveyardWithReplacements(ctx, playerId, discarded, zones.graveyard as any[], {});
  zones.handCount = hand.length;
  zones.graveyardCount = Array.isArray(zones.graveyard) ? zones.graveyard.length : 0;
  try {
    const stateAny = game.state as any;
    stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
    stateAny.discardedCardThisTurn[String(playerId)] = true;
    stateAny.anyPlayerDiscardedCardThisTurn = true;
  } catch { /* tracking is best-effort */ }
  return true;
}

export async function tryHandleBreathstealerPayOrDiscard(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepData = step as any;
  if (stepData[BREATHSTEALER_PAY_OR_DISCARD_FLAG] !== true) return false;

  const playerId = String(response.playerId || '').trim();
  const amount = Math.max(1, Math.floor(Number(stepData.amount || 0)));
  const cardId = String(stepData.cardId || stepData.sourceId || '');
  const cardName = String(stepData.cardName || 'creature card');
  const action = selectedAction(response);
  const payChosen = action === 'pay' || action === `pay ${amount} life`;

  if (payChosen && !response.cancelled) {
    const paid = payLifeAmount(game.state, playerId, amount, {
      ctx: { state: game.state, gameId, isReplaying: Boolean((game as any).isReplaying) },
    });
    if (!paid.paid && !paid.replaced) {
      emitToPlayer(io, playerId as any, 'error', {
        code: 'CANNOT_PAY_COST',
        message: `Cannot pay ${amount} life to keep ${cardName}. It is discarded.`,
      });
      discardDrawnCard(game, gameId, playerId, cardId);
    } else if (!paid.replaced) {
      try {
        (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
        (game.state as any).lifeLostThisTurn[playerId] =
          ((game.state as any).lifeLostThisTurn[playerId] || 0) + amount;
      } catch { /* tracking is best-effort */ }
      try {
        queueLifePaymentTriggers(game as any, playerId, amount, {
          sourceId: String(stepData.sourceId || ''),
          sourceName: String(stepData.sourceName || ''),
        });
      } catch (err) { reportHookFailure('trigger.best-effort', err, { source: 'breathstealerPayOrDiscardHandler' }); /* triggers are best-effort */ }
    }
    if (paid.paid || paid.replaced) {
      try {
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${getPlayerName(game, playerId)} pays ${amount} life to keep ${cardName}.`,
          ts: Date.now(),
        });
      } catch { /* chat is best-effort */ }
    }
  } else {
    discardDrawnCard(game, gameId, playerId, cardId);
    try {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, playerId)} discards ${cardName}.`,
        ts: Date.now(),
      });
    } catch { /* chat is best-effort */ }
  }

  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  broadcastGame(io, game, gameId);
  return true;
}
