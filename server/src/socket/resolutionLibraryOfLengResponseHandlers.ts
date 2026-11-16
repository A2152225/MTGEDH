/**
 * socket/resolutionLibraryOfLengResponseHandlers.ts
 *
 * OPTION_CHOICE response for Library of Leng discard-to-library-top.
 * Public: handleLibraryOfLengDiscardChoiceResponse.
 */

import type { Server } from 'socket.io';
import { appendEvent } from '../db/index.js';
import { debug, debugWarn, debugError } from '../utils/debug.js';
import { broadcastGame, getPlayerName } from './util.js';
import { applyLibraryOfLengDiscardChoiceOnContext } from '../state/modules/libraryOfLengDiscardChoice.js';

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

export async function handleLibraryOfLengDiscardChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: any,
  response: any,
): Promise<boolean> {
  if (!step || step.libraryOfLengDiscardChoice !== true) return false;
  const playerId = String(step.playerId || response?.playerId || '').trim();
  const cardId = String(step.cardId || step.sourceId || '').trim();
  const choiceId = firstId(response?.selections);
  const putOnLibraryTop = !response?.cancelled && choiceId === 'library_top';
  if (!playerId || !cardId) return true;

  try {
    const result = applyLibraryOfLengDiscardChoiceOnContext(game, {
      playerId,
      cardId,
      putOnLibraryTop,
      batchId: String(step.libraryOfLengBatchId || ''),
    });
    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'libraryOfLengDiscardChoiceResolve', {
        playerId,
        cardId,
        putOnLibraryTop: result.putOnLibraryTop,
        batchId: String(step.libraryOfLengBatchId || ''),
        resolvedStepId: String(step.id || '').trim() || undefined,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist libraryOfLengDiscardChoiceResolve event:', err);
    }
    const cardName = String(step.sourceName || 'a card');
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: result.putOnLibraryTop
        ? `${getPlayerName(game, playerId)} puts ${cardName} on top of their library.`
        : `${getPlayerName(game, playerId)} leaves ${cardName} in their graveyard.`,
      ts: Date.now(),
    });
    broadcastGame(io, game, gameId);
    debug(2, `[handleLibraryOfLengDiscardChoiceResponse] ${playerId} ${putOnLibraryTop ? 'library_top' : 'graveyard'} ${cardId}`);
  } catch (err) {
    debugError(1, '[handleLibraryOfLengDiscardChoiceResponse] Error:', err);
  }
  return true;
}
