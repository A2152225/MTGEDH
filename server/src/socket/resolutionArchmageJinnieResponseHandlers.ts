/**
 * socket/resolutionArchmageJinnieResponseHandlers.ts
 *
 * Resolution-queue responses for Archmage Ascension (LIBRARY_SEARCH +
 * archmageAscensionSearchInstead) and Jinnie Fay (OPTION_CHOICE +
 * jinnieFayTokenChoice). Public:
 * handleArchmageAscensionSearchResponse, handleJinnieFayTokenChoiceResponse.
 */

import type { Server } from 'socket.io';
import { appendEvent } from '../db/index.js';
import { debug, debugWarn, debugError } from '../utils/debug.js';
import { broadcastGame, getPlayerName } from './util.js';
import { applyArchmageAscensionSearchOnContext } from '../state/modules/zones-handlers/zonesDrawReplacementArchmageApply.js';
import { applyJinnieFayTokenChoiceOnContext } from '../state/modules/counters_tokens-handlers/countersTokensJinnieFayApply.js';

function firstId(value: unknown): string {
  if (Array.isArray(value) && value.length) {
    const first = value[0];
    if (typeof first === 'string') return first.trim();
    if (first && typeof first === 'object') return String((first as any).id || (first as any).value || '').trim();
    return String(first || '').trim();
  }
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') return String((value as any).id || (value as any).value || '').trim();
  return '';
}

function selectedCardIds(response: any): string[] {
  const selections = response?.selections;
  if (Array.isArray(selections)) {
    return selections.map((id: any) => {
      if (typeof id === 'string') return id.trim();
      if (id && typeof id === 'object') return String(id.id || id.value || '').trim();
      return String(id || '').trim();
    }).filter(Boolean);
  }
  if (selections && typeof selections === 'object') {
    const raw = (selections as any).selectedCardIds || (selections as any).cardIds || (selections as any).ids || (selections as any).toHand;
    if (Array.isArray(raw)) return raw.map((id: any) => String(id || '').trim()).filter(Boolean);
    const one = firstId(selections);
    return one ? [one] : [];
  }
  const one = firstId(selections);
  return one ? [one] : [];
}

export async function handleArchmageAscensionSearchResponse(
  io: Server,
  game: any,
  gameId: string,
  step: any,
  response: any,
): Promise<boolean> {
  if (!step || step.archmageAscensionSearchInstead !== true) return false;
  const playerId = String(step.playerId || response?.playerId || '').trim();
  if (!playerId) return true;

  const ids = selectedCardIds(response);
  const declined = response?.cancelled === true || ids.length === 0;
  const chosenCardId = declined ? '' : ids[0];
  const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(step.remainingDrawCountAfterChoice || 0)));

  try {
    const result = applyArchmageAscensionSearchOnContext(game, {
      playerId,
      chosenCardId,
      declined,
      remainingDrawCountAfterChoice,
      resumeRemaining: true,
    });
    if (!result.applied) {
      debugWarn(1, '[handleArchmageAscensionSearchResponse] apply failed', result.reason);
    }

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'archmageAscensionSearchInsteadResolve', {
        playerId,
        resolvedStepId: String(step.id || '').trim() || undefined,
        chosenCardId: chosenCardId || undefined,
        declined,
        remainingDrawCountAfterChoice,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist archmageAscensionSearchInsteadResolve event:', err);
    }

    const drawnName = String(result.drawn?.name || result.drawn?.card?.name || 'a card');
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: declined
        ? `${getPlayerName(game, playerId)} draws a card (declines Archmage Ascension).`
        : `${getPlayerName(game, playerId)} searches their library for ${drawnName} instead of drawing (Archmage Ascension).`,
      ts: Date.now(),
    });
    broadcastGame(io, game, gameId);
    debug(2, `[handleArchmageAscensionSearchResponse] ${playerId} ${declined ? 'declined' : 'chose ' + chosenCardId}`);
  } catch (err) {
    debugError(1, '[handleArchmageAscensionSearchResponse] Error:', err);
  }
  return true;
}

export async function handleJinnieFayTokenChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: any,
  response: any,
): Promise<boolean> {
  if (!step || step.jinnieFayTokenChoice !== true) return false;
  const playerId = String(step.playerId || response?.playerId || '').trim();
  if (!playerId) return true;

  const choiceId = firstId(response?.selections) || (response?.cancelled ? 'normal' : '') || 'normal';
  try {
    const result = applyJinnieFayTokenChoiceOnContext(game, {
      playerId,
      choiceId,
      cancelled: response?.cancelled === true,
      faces: step.jinnieFayFaces,
      original: step.jinnieFayOriginalTokenCreate,
      gameId,
    });

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'jinnieFayTokenChoiceResolve', {
        playerId,
        resolvedStepId: String(step.id || '').trim() || undefined,
        choiceId: result.choiceId,
        faces: step.jinnieFayFaces,
        jinnieFayOriginalTokenCreate: step.jinnieFayOriginalTokenCreate
          ? JSON.parse(JSON.stringify(step.jinnieFayOriginalTokenCreate))
          : undefined,
        createdTokenIds: result.createdIds,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist jinnieFayTokenChoiceResolve event:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: result.choiceId === 'normal'
        ? `${getPlayerName(game, playerId)} creates ${result.count} ${result.tokenName} token(s).`
        : `${getPlayerName(game, playerId)} uses Jinnie Fay to create ${result.count} ${result.tokenName} token(s).`,
      ts: Date.now(),
    });
    broadcastGame(io, game, gameId);
  } catch (err) {
    debugError(1, '[handleJinnieFayTokenChoiceResponse] Error:', err);
  }
  return true;
}
