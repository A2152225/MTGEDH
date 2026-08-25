/**
 * socket/resolution-handlers/extortPaymentResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse switch).
 * Cluster moved: handleExtortPaymentResponse (pay {W/B} for Extort, opponents lose 1, you gain that much).
 * Public entry symbols: handleExtortPaymentResponse.
 *
 * Terminal for the case: the original `break` becomes `return`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import {
  applySelectedManaPaymentForResolutionCost,
  extractResolutionPaymentItems,
} from "./resolutionManaPaymentApplication.js";
import {
  appendKeywordPromptResolveEvent,
  emitKeywordChoiceChat,
  extractResolutionChoiceId,
} from "../resolutionKeywordChoiceHandlers.js";
import { broadcastGame, broadcastManaPoolUpdate, emitToPlayer, getPlayerName } from "../util.js";

/** EXTORT_PAYMENT: pay the extort mana cost or decline. */
export function handleExtortPaymentResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const stepData = step as any;
  const choiceId = String(extractResolutionChoiceId(response.selections) || '').trim().toLowerCase();
  const pid = String(response.playerId || step.playerId || '').trim();
  const manaCost = String(stepData?.manaCost || '{W/B}').trim();
  const payment = extractResolutionPaymentItems(response.selections as any);

  if (response.cancelled || choiceId === 'skip') {
    appendKeywordPromptResolveEvent(gameId, game, step, response, { keyword: 'extort', choiceId, manaCost, payment });
    return;
  }

  const applied = applySelectedManaPaymentForResolutionCost(game, pid, manaCost, payment);
  if (!applied.ok) {
    const appliedError = applied as { ok: false; code: string; message: string };
    emitToPlayer(io, pid as any, 'error', {
      code: appliedError.code,
      message: appliedError.message,
    });
    return;
  }

  appendKeywordPromptResolveEvent(gameId, game, step, response, {
    keyword: 'extort',
    choiceId,
    manaCost,
    payment,
    // Payment taps/mana already persisted by applySelectedManaPaymentForResolutionCost.
    paymentMutationsPersistedSeparately: true,
    ...(Array.isArray(applied.sacrificedPermanents) && applied.sacrificedPermanents.length > 0
      ? { sacrificedPermanents: applied.sacrificedPermanents }
      : {}),
  });

  const stateAny = game.state as any;
  stateAny.life = stateAny.life || {};
  const opponents = Array.isArray(stateAny.players)
    ? stateAny.players.filter((player: any) => String(player?.id || '') !== pid)
    : [];

  let totalLifeLost = 0;
  for (const opponent of opponents) {
    const opponentId = String(opponent?.id || '').trim();
    if (!opponentId) continue;

    const currentLife = Number(stateAny.life?.[opponentId] ?? opponent?.life ?? stateAny.startingLife ?? 40);
    const nextLife = Math.max(0, currentLife - 1);
    const lifeLost = Math.max(0, currentLife - nextLife);

    stateAny.life[opponentId] = nextLife;
    if (opponent && typeof opponent === 'object') {
      opponent.life = nextLife;
    }
    if (lifeLost > 0) {
      totalLifeLost += lifeLost;
      stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
      stateAny.lifeLostThisTurn[opponentId] = Number(stateAny.lifeLostThisTurn[opponentId] || 0) + lifeLost;
    }
  }

  const controllerPlayer = Array.isArray(stateAny.players)
    ? stateAny.players.find((player: any) => String(player?.id || '') === pid)
    : null;
  const controllerLife = Number(stateAny.life?.[pid] ?? controllerPlayer?.life ?? stateAny.startingLife ?? 40);
  stateAny.life[pid] = controllerLife + totalLifeLost;
  stateAny.lifeGainedThisTurn = stateAny.lifeGainedThisTurn || {};
  stateAny.lifeGainedThisTurn[pid] = Number(stateAny.lifeGainedThisTurn[pid] || 0) + totalLifeLost;
  if (controllerPlayer && typeof controllerPlayer === 'object') {
    controllerPlayer.life = stateAny.life[pid];
  }

  const sourceName = String(step.sourceName || stepData?.cardName || 'Extort');
  broadcastManaPoolUpdate(io, gameId, pid, ((game.state as any)?.manaPool?.[pid] || {}) as any, `Paid ${manaCost} for ${sourceName}`, game);
  emitKeywordChoiceChat(
    io,
    gameId,
    sourceName,
    `${getPlayerName(game, pid)} paid ${manaCost} for extort. Each opponent loses 1 life and ${getPlayerName(game, pid)} gains ${totalLifeLost} life.`
  );

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
  broadcastGame(io, game, gameId);
}
