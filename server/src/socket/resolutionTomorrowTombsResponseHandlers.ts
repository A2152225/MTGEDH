/**
 * socket/resolutionTomorrowTombsResponseHandlers.ts
 *
 * Resolution-queue responses for Tomorrow (PONDER_EFFECT + tomorrowDrawReplacement)
 * and Out of the Tombs (GRAVEYARD_SELECTION + outOfTheTombsDraw).
 * Public: handleTomorrowDrawReplacementResponse, handleOutOfTheTombsDrawResponse.
 */

import type { Server } from 'socket.io';
import { appendEvent } from '../db/index.js';
import { debug, debugWarn, debugError } from '../utils/debug.js';
import { broadcastGame, emitToPlayer, getPlayerName } from './util.js';
import { applyTomorrowLookPutDrawOnContext } from '../state/modules/zones-handlers/zonesDrawReplacementTomorrowApply.js';
import { applyOutOfTheTombsDrawOnContext } from '../state/modules/zones-handlers/zonesDrawReplacementOutOfTheTombsApply.js';

function firstId(value: unknown): string {
  if (Array.isArray(value) && value.length) return String(value[0] || '').trim();
  if (typeof value === 'string') return value.trim();
  return '';
}

export async function handleTomorrowDrawReplacementResponse(
  io: Server,
  game: any,
  gameId: string,
  step: any,
  response: any,
): Promise<boolean> {
  if (!step || step.tomorrowDrawReplacement !== true) return false;
  const playerId = String(step.playerId || response?.playerId || '').trim();
  if (!playerId) return true;

  if (response?.cancelled) {
    emitToPlayer(io, playerId as any, 'error', {
      code: 'STEP_MANDATORY',
      message: 'This replacement is mandatory and cannot be cancelled.',
    });
    return true;
  }

  const selections = (response?.selections && typeof response.selections === 'object') ? response.selections : {};
  const toHand = Array.isArray(selections.toHand) ? selections.toHand.map((id: any) => String(id || '').trim()).filter(Boolean) : [];
  const newOrder = Array.isArray(selections.newOrder) ? selections.newOrder.map((id: any) => String(id || '').trim()).filter(Boolean) : [];
  const lookedIds = (Array.isArray(step.cards) ? step.cards : []).map((c: any) => String(c?.id || '').trim()).filter(Boolean);
  let chosenCardId = toHand[0] || '';
  if (!chosenCardId) {
    chosenCardId = lookedIds.find((id: string) => !newOrder.includes(id)) || lookedIds[0] || '';
  }
  const bottomOrder = newOrder.filter((id: string) => id && id !== chosenCardId);
  const lookCount = Math.max(0, Math.floor(Number(step.lookAtLibraryTop || step.cardCount || lookedIds.length || 0)));
  const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(step.remainingDrawCountAfterChoice || 0)));

  try {
    const result = applyTomorrowLookPutDrawOnContext(game, {
      playerId,
      lookCount,
      chosenCardId,
      bottomOrder,
      remainingDrawCountAfterChoice,
      resumeRemaining: true,
    });
    if (!result.applied) {
      emitToPlayer(io, playerId as any, 'error', {
        code: 'TOMORROW_REPLACEMENT_FAILED',
        message: 'Unable to apply the look-and-put draw replacement.',
      });
      return true;
    }

    const handName = String(result.handCard?.name || result.handCard?.card?.name || 'a card');
    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'tomorrowLookPutDrawResolve', {
        playerId,
        resolvedStepId: String(step.id || '').trim() || undefined,
        chosenCardId,
        bottomOrder,
        lookCount,
        remainingDrawCountAfterChoice,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist tomorrowLookPutDrawResolve event:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} puts ${handName} into their hand and the rest on the bottom of their library.`,
      ts: Date.now(),
    });
    broadcastGame(io, game, gameId);
    debug(2, `[handleTomorrowDrawReplacementResponse] ${playerId} chose ${chosenCardId}`);
  } catch (err) {
    debugError(1, '[handleTomorrowDrawReplacementResponse] Error:', err);
  }
  return true;
}

export async function handleOutOfTheTombsDrawResponse(
  io: Server,
  game: any,
  gameId: string,
  step: any,
  response: any,
): Promise<boolean> {
  if (!step || step.outOfTheTombsDraw !== true && String(step.purpose || '') !== 'outOfTheTombsDraw') return false;
  const playerId = String(step.playerId || response?.playerId || '').trim();
  if (!playerId) return true;

  if (response?.cancelled) {
    emitToPlayer(io, playerId as any, 'error', {
      code: 'STEP_MANDATORY',
      message: 'You must return a creature card from your graveyard.',
    });
    return true;
  }

  let chosenCardId = '';
  const selections = response?.selections;
  if (Array.isArray(selections)) chosenCardId = firstId(selections);
  else if (selections && typeof selections === 'object') {
    chosenCardId = firstId((selections as any).selectedCardIds) || firstId((selections as any).cardIds) || firstId((selections as any).ids);
  } else {
    chosenCardId = firstId(selections);
  }
  if (!chosenCardId) {
    emitToPlayer(io, playerId as any, 'error', {
      code: 'INVALID_SELECTION',
      message: 'Select a creature card to return.',
    });
    return true;
  }

  const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(step.remainingDrawCountAfterChoice || 0)));
  try {
    const result = applyOutOfTheTombsDrawOnContext(game, {
      playerId,
      chosenCardId,
      remainingDrawCountAfterChoice,
      resumeRemaining: true,
    });
    if (!result.applied) {
      emitToPlayer(io, playerId as any, 'error', {
        code: 'OUT_OF_THE_TOMBS_FAILED',
        message: result.needsChoice
          ? 'Select a creature card to return.'
          : 'Unable to apply Out of the Tombs.',
      });
      return true;
    }

    const returnedName = String(result.returned?.name || result.returned?.card?.name || 'a creature');
    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'outOfTheTombsDrawResolve', {
        playerId,
        resolvedStepId: String(step.id || '').trim() || undefined,
        chosenCardId,
        remainingDrawCountAfterChoice,
        lost: result.lost === true,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist outOfTheTombsDrawResolve event:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: result.lost
        ? `${getPlayerName(game, playerId)} loses the game (Out of the Tombs).`
        : `${getPlayerName(game, playerId)} returns ${returnedName} from their graveyard (Out of the Tombs).`,
      ts: Date.now(),
    });
    broadcastGame(io, game, gameId);
  } catch (err) {
    debugError(1, '[handleOutOfTheTombsDrawResponse] Error:', err);
  }
  return true;
}
