/**
 * socket/resolution-handlers/optionChoiceLandEntryReplacementHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the four OPTION_CHOICE prompts a land asks as it enters - shock lands (pay 2 life
 * or enter tapped), Snarl style reveal lands (reveal a matching land from hand or enter tapped),
 * the land-sacrifice would-enter replacement, and the Mox Diamond style discard-a-land would-enter
 * replacement.
 * Public entry symbols: handleShockLandChoice, handleRevealLandChoice,
 * handleLandWouldEnterSacrificeChoice, handleMoxDiamondChoice.
 *
 * Every branch always returned, so each call site is `await handler(...); return;`. The
 * land-sacrifice branch's local `extractSelectionIds` closure moved to
 * `resolutionOptionChoiceSelectionIds.ts` so other OPTION_CHOICE extracts can share it.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import {
  resolveLandWouldEnterSacrificeChoice,
  resolveWouldEnterDiscardLandChoice,
} from "../../state/modules/land-would-enter-replacement.js";
import { queueLifePaymentTriggers } from "../../state/modules/triggers/pay-life.js";
import type {
  ResolutionStep,
  ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";
import {
  extractOptionChoiceSelectionId,
  extractOptionChoiceSelectionIds,
} from "./resolutionOptionChoiceSelectionIds.js";

/** Shock lands: pay 2 life or enter tapped. */
export async function handleShockLandChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const selectedOption = response.selections;
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(selectedOption);
  const permanentId = String(stepData?.permanentId || '').trim();
  const payLifeAmount = Number(stepData?.payLifeAmount || 2);
  if (!permanentId) {
    debugWarn(1, `[Resolution] shockLandChoice: missing permanentId`);
    return;
  }

  const battlefield = game.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p && p.id === permanentId);
  if (!permanent) {
    debugWarn(1, `[Resolution] shockLandChoice: permanent not found (${permanentId})`);
    return;
  }

  const cardName = String(stepData?.cardName || permanent?.card?.name || 'Land');

  // Treat cancel/unknown as choosing to enter tapped.
  const normalized = String(choiceId || '').toLowerCase();
  const shouldPayLife = !response.cancelled && normalized === 'pay_2_life';

  if (shouldPayLife) {
    // Ensure life object exists before accessing
    if (!(game.state as any).life) {
      (game.state as any).life = {};
    }

    const currentLife = (game.state as any).life[playerId] ?? (game as any).life?.[playerId] ?? 40;
    if (typeof currentLife !== 'number' || currentLife < payLifeAmount) {
      debugWarn(1, `[Resolution] shockLandChoice: insufficient life to pay ${payLifeAmount} (life=${currentLife}), entering tapped`);
      (permanent as any).tapped = true;
    } else {
      const newLife = currentLife - payLifeAmount;
      (game.state as any).life[playerId] = newLife;
      if ((game as any).life) {
        (game as any).life[playerId] = newLife;
      }

      const players = game.state?.players || [];
      const player = players.find((p: any) => p.id === playerId);
      if (player) {
        (player as any).life = newLife;
      }

      (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
      (game.state as any).lifeLostThisTurn[playerId] =
        Number((game.state as any).lifeLostThisTurn[playerId] || 0) + payLifeAmount;
      queueLifePaymentTriggers(game as any, String(playerId), payLifeAmount, { sourceId: permanentId, sourceName: cardName });

      (permanent as any).tapped = false;

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, playerId)} pays ${payLifeAmount} life for ${cardName} to enter untapped. (${currentLife} → ${newLife})`,
        ts: Date.now(),
      });
    }
  } else {
    (permanent as any).tapped = true;
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)}'s ${cardName} enters the battlefield tapped.`,
      ts: Date.now(),
    });
  }

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'shockLandChoice', {
      playerId,
      resolvedStepId: String((step as any).id || '').trim(),
      permanentId,
      payLife: shouldPayLife,
      cardName,
    });
  } catch (e) {
    debugWarn(1, '[Resolution] Failed to persist shockLandChoice event:', e);
  }

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }

  broadcastGame(io, game, gameId);
}

/** Reveal lands (Snarl lands): reveal a matching land from hand or enter tapped. */
export async function handleRevealLandChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const selectedOption = response.selections;
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(selectedOption);
  const permanentId = String(stepData?.permanentId || '').trim();
  if (!permanentId) {
    debugWarn(1, `[Resolution] revealLandChoice: missing permanentId`);
    return;
  }

  const battlefield = game.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p && p.id === permanentId);
  if (!permanent) {
    debugWarn(1, `[Resolution] revealLandChoice: permanent not found (${permanentId})`);
    return;
  }

  const cardName = String(stepData?.cardName || permanent?.card?.name || 'Land');
  const normalized = String(choiceId || '').toLowerCase();
  const revealCardId = !response.cancelled && choiceId && normalized !== 'decline_reveal' ? String(choiceId) : null;

  let revealedName: string | null = null;
  if (revealCardId) {
    const zones = game.state?.zones?.[playerId];
    const hand = zones && Array.isArray((zones as any).hand) ? ((zones as any).hand as any[]) : [];
    const revealedCard = hand.find((c: any) => c && String(c.id) === String(revealCardId));
    revealedName = revealedCard?.name ? String(revealedCard.name) : null;
  }

  if (revealedName) {
    (permanent as any).tapped = false;
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} reveals ${revealedName}. ${cardName} enters untapped.`,
      ts: Date.now(),
    });
  } else {
    (permanent as any).tapped = true;
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)}'s ${cardName} enters tapped (didn't reveal a card).`,
      ts: Date.now(),
    });
  }

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'revealLandChoice', {
      playerId,
      resolvedStepId: String((step as any).id || '').trim(),
      permanentId,
      revealCardId: revealedName ? revealCardId : null,
      cardName,
    });
  } catch (e) {
    debugWarn(1, '[Resolution] Failed to persist revealLandChoice event:', e);
  }

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }

  broadcastGame(io, game, gameId);
}

/** Land would-enter replacement: sacrifice lands or it goes to the graveyard. */
export async function handleLandWouldEnterSacrificeChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const selectedOption = response.selections;
  const stepData = step as any;
  const playerId = response.playerId;

  const selectionIds = extractOptionChoiceSelectionIds(selectedOption);
  const cardName = String(stepData?.sourceName || 'Land');
  const landCtx = {
    state: game.state,
    libraries: (game as any).libraries,
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    rng: (game as any).rng,
    gameId,
  } as any;

  const resolved = resolveLandWouldEnterSacrificeChoice(
    landCtx,
    playerId,
    selectionIds,
    Boolean(response.cancelled),
  );
  if (!resolved) {
    emitToPlayer(io, playerId, 'error', {
      code: 'INVALID_SELECTION',
      message: 'Could not resolve land sacrifice replacement (invalid selection or missing pending land).',
    });
    return;
  }

  const declined = Boolean(response.cancelled) || selectionIds.includes('decline_land_would_enter');
  const sacrificedIds = declined
    ? null
    : selectionIds.filter((id) => id !== 'decline_land_would_enter');

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: declined
      ? `${getPlayerName(game, playerId)} declines to sacrifice lands. ${cardName} goes to the graveyard.`
      : `${getPlayerName(game, playerId)} sacrifices lands. ${cardName} enters the battlefield.`,
    ts: Date.now(),
  });

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'landWouldEnterSacrificeChoice', {
      playerId,
      resolvedStepId: String((step as any).id || '').trim(),
      sacrificePermanentIds: sacrificedIds,
      cardName,
    });
  } catch (e) {
    debugWarn(1, '[Resolution] Failed to persist landWouldEnterSacrificeChoice event:', e);
  }

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }

  broadcastGame(io, game, gameId);
}

/** Would-enter discard land replacement (Mox Diamond): discard a land or it goes to the graveyard. */
export async function handleMoxDiamondChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const selectedOption = response.selections;
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(selectedOption);
  const stackItemId = String(stepData?.stackItemId || step.sourceId || '').trim();
  if (!stackItemId) {
    debugWarn(1, `[Resolution] moxDiamondChoice: missing stackItemId/sourceId`);
    return;
  }

  game.state = (game.state || {}) as any;
  game.state.stack = game.state.stack || [];
  game.state.battlefield = game.state.battlefield || [];

  const discardCtx = {
    state: game.state,
    libraries: (game as any).libraries,
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    rng: (game as any).rng,
    gameId,
  } as any;

  const resolved = resolveWouldEnterDiscardLandChoice(
    discardCtx,
    playerId,
    stackItemId,
    choiceId,
    Boolean(response.cancelled),
  );

  if (resolved.ok === false) {
    if (resolved.errorCode === 'LAND_NOT_IN_HAND') {
      emitToPlayer(io, playerId, 'error', {
        code: 'LAND_NOT_IN_HAND',
        message: 'Selected land card not found in hand (or not a land).',
      });
    } else {
      debugWarn(1, `[Resolution] moxDiamondChoice: stack item not found (${stackItemId})`);
    }
    return;
  }

  // Drop any duplicate discard-land prompts for the same stack object (e.g. from
  // Smart Pass re-resolving while the first choice was still open).
  try {
    const { cancelSiblingWouldEnterDiscardLandSteps } = await import(
      '../../state/modules/land-would-enter-replacement.js'
    );
    cancelSiblingWouldEnterDiscardLandSteps(gameId, stackItemId, String((step as any).id || ''));
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to cancel sibling moxDiamondChoice steps:', err);
  }

  const { cardName, discardedLandName, discardLandId } = resolved;

  if (discardedLandName) {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} discards ${discardedLandName}. ${cardName} enters the battlefield.`,
      ts: Date.now(),
    });
  } else {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} declines to discard. ${cardName} goes to the graveyard.`,
      ts: Date.now(),
    });
  }

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'moxDiamondChoice', {
      playerId,
      resolvedStepId: String((step as any).id || '').trim(),
      stackItemId,
      discardLandId: discardedLandName ? discardLandId : null,
      cardName,
    });
  } catch (e) {
    debugWarn(1, '[Resolution] Failed to persist moxDiamondChoice event:', e);
  }

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }

  broadcastGame(io, game, gameId);
}
