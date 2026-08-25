/**
 * socket/resolution-handlers/preGameHandStepResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse).
 * Cluster moved: the two pre-game hand steps - `case ResolutionStepType.OPENING_HAND_ACTIONS`
 * (put the chosen "begins the game on the battlefield" cards - Leylines, Chancellors - onto the
 * battlefield, or persist a skip) and `case ResolutionStepType.HAND_TO_BOTTOM` (the London mulligan
 * bottoming: validate the count and the cards, move them to the bottom of the library in random
 * order, finalize mulliganState, cancel duplicate prompts, then check for opening-hand actions).
 * Public entry symbols: handleOpeningHandActionsResponse, handleHandToBottomResponse.
 *
 * `handleOpeningHandActionsResponse` only ever `break`s, so its call site is
 * `handler(...); break;`. `handleHandToBottomResponse` had one path that `return`ed from
 * handleStepResponse instead of breaking (a selected card missing from hand), so it reports
 * 'return' or 'break' and the call site honours it.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { checkAndPromptOpeningHandActions, getOpeningHandBattlefieldCounters, isOpeningHandBattlefieldCard } from "../opening-hand.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";

/** Whether the parent should `return` out of handleStepResponse or just `break` the switch. */
export type StepResponseExit = 'return' | 'break';

/** Pre-game "you may begin the game with these on the battlefield" prompt. */
export function handleOpeningHandActionsResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const selectionsRaw = response.selections as any;
  const selectedCardIds: string[] = Array.isArray(selectionsRaw)
    ? selectionsRaw.map((x: any) => String(x)).filter((x: string) => x.length > 0)
    : [];

  const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
  if (phaseStr !== "" && phaseStr !== "PRE_GAME") {
    // If we're no longer pregame, ignore.
    return;
  }

  const zones = game.state?.zones?.[pid];
  if (!zones || !Array.isArray(zones.hand)) {
    return;
  }

  const hand = zones.hand as any[];
  game.state.battlefield = game.state.battlefield || [];
  const battlefield = game.state.battlefield;

  if (response.cancelled || selectedCardIds.length === 0) {
    try {
      appendEvent(gameId, (game as any).seq ?? 0, "skipOpeningHandActions", { playerId: pid });
    } catch (e) {
      debugWarn(1, "appendEvent(skipOpeningHandActions) failed:", e);
    }
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  const playedCards: string[] = [];
  for (const cardId of selectedCardIds) {
    const idx = hand.findIndex((c: any) => c?.id === cardId);
    if (idx === -1) continue;
    const card = hand[idx];
    if (!isOpeningHandBattlefieldCard(card, pid, game.state)) continue;
    hand.splice(idx, 1);

    battlefield.push({
      id: card.id,
      card: {
        ...card,
        zone: 'battlefield',
      },
      controller: pid,
      owner: pid,
      tapped: false,
      counters: getOpeningHandBattlefieldCounters(card, pid, game.state),
    } as any);
    playedCards.push(String(card?.name || 'Unknown'));
  }

  zones.handCount = hand.length;

  try {
    appendEvent(gameId, (game as any).seq ?? 0, "playOpeningHandCards", {
      playerId: pid,
      cardIds: selectedCardIds,
    });
  } catch (e) {
    debugWarn(1, "appendEvent(playOpeningHandCards) failed:", e);
  }

  if (playedCards.length > 0) {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} begins the game with ${playedCards.join(", ")} on the battlefield.`,
      ts: Date.now(),
    });
  }

  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  broadcastGame(io, game, gameId);
}

/** London mulligan: put the chosen cards on the bottom of the library in random order. */
export function handleHandToBottomResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): StepResponseExit {
  // Currently used for London Mulligan: put N chosen cards from hand on bottom in random order.
  const stepData = step as any;
  const pid = response.playerId;
  const selected = response.selections as any;

  const mulliganState = (game.state as any).mulliganState?.[pid];
  const pendingBottomCount = Number(mulliganState?.pendingBottomCount || 0);
  const expected = pendingBottomCount > 0
    ? pendingBottomCount
    : Number(stepData.cardsToBottom || 0);

  if (!Array.isArray(selected) || !selected.every((x: any) => typeof x === 'string')) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_SELECTION',
      message: 'Invalid selection format for HAND_TO_BOTTOM',
    });
    return 'break';
  }

  const cardIds = selected as string[];
  if (expected <= 0 || cardIds.length !== expected) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_SELECTION',
      message: `Must select exactly ${expected} card${expected === 1 ? '' : 's'} to put to bottom`,
    });
    return 'break';
  }

  const zones = (game.state as any)?.zones?.[pid];
  if (!zones || !Array.isArray(zones.hand)) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'NO_HAND',
      message: 'Hand not found',
    });
    return 'break';
  }

  // Validate that all selected cards are in hand
  const hand = zones.hand as any[];
  const handIds = new Set(hand.map((c: any) => c?.id));
  for (const cardId of cardIds) {
    if (!handIds.has(cardId)) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'CARD_NOT_IN_HAND',
        message: 'Selected card not found in hand',
      });
      return 'return';
    }
  }

  // Remove selected cards from hand
  const cardsToBottom: any[] = [];
  for (const cardId of cardIds) {
    const idx = hand.findIndex((c: any) => c?.id === cardId);
    if (idx !== -1) {
      const [card] = hand.splice(idx, 1);
      cardsToBottom.push(card);
    }
  }

  // Shuffle the cards before putting to bottom (random order)
  for (let i = cardsToBottom.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cardsToBottom[i], cardsToBottom[j]] = [cardsToBottom[j], cardsToBottom[i]];
  }

  // Get the library and add cards to the bottom
  const lib = typeof game.libraries?.get === 'function'
    ? game.libraries.get(pid) || []
    : [];

  for (const card of cardsToBottom) {
    card.zone = 'library';
    lib.push(card);
  }

  if (typeof game.libraries?.set === 'function') {
    game.libraries.set(pid, lib);
  }

  // Update zone counts
  zones.handCount = hand.length;
  zones.libraryCount = lib.length;

  // Mark mulligan as complete
  const mulligansTaken = Number(mulliganState?.mulligansTaken || 0);
  (game.state as any).mulliganState = (game.state as any).mulliganState || {};
  (game.state as any).mulliganState[pid] = {
    hasKeptHand: true,
    mulligansTaken,
    pendingBottomCount: 0,
    pendingBottomStepId: null,
  };

  // Defensive: if duplicate HAND_TO_BOTTOM steps were enqueued (double-clicks, reconnect races, etc.),
  // cancel any remaining ones so the player isn't prompted again.
  try {
    const queue = ResolutionQueueManager.getQueue(gameId);
    const remaining = queue.steps.filter(
      (s: any) => s && s.playerId === pid && s.type === ResolutionStepType.HAND_TO_BOTTOM
    );
    if (remaining.length > 0) {
      debugWarn(1, '[Resolution] Cancelling duplicate HAND_TO_BOTTOM steps', {
        gameId,
        playerId: pid,
        count: remaining.length,
        stepIds: remaining.map((s: any) => s.id),
      });
      for (const s of remaining) {
        try {
          ResolutionQueueManager.cancelStep(gameId, s.id);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'mulliganPutToBottom', {
      playerId: pid,
      resolvedStepId: String((step as any).id || ''),
      cardIds,
      mulligansTaken,
    });
  } catch (e) {
    debugWarn(1, 'appendEvent(mulliganPutToBottom) failed:', e);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} keeps their hand (${hand.length} cards, put ${cardsToBottom.length} to bottom).`,
    ts: Date.now(),
  });

  // Check for opening hand actions (Leylines) and prompt if any exist
  checkAndPromptOpeningHandActions(io, game, gameId, pid);
  return 'break';
}
