/**
 * socket/resolutionTransformAttachPlayerResponseHandlers.ts
 *
 * TARGET_SELECTION response for transform-attach-to-player (Curse of Leeches
 * family). Public: handleTransformAttachPlayerChoiceResponse.
 */

import type { Server } from 'socket.io';
import { appendEvent } from '../db/index.js';
import { debug, debugWarn, debugError } from '../utils/debug.js';
import { broadcastGame, getPlayerName } from './util.js';
import { applyTransformAttachPlayerChoiceOnContext } from '../state/modules/transformAttachPlayerChoice.js';

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

export async function handleTransformAttachPlayerChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: any,
  response: any,
): Promise<boolean> {
  if (!step || step.transformAttachToPlayerChoice !== true) return false;
  const chooserId = String(step.playerId || response?.playerId || '').trim();
  const permanentId = String(step.permanentId || step.sourceId || '').trim();
  let playerId = firstId(response?.selections);
  if (!playerId && Array.isArray(step.validTargets) && step.validTargets[0]) {
    playerId = String(step.validTargets[0].id || '').trim();
  }
  if (!permanentId || !playerId) return true;

  try {
    applyTransformAttachPlayerChoiceOnContext(game, { permanentId, playerId });
    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'transformAttachToPlayerResolve', {
        playerId: chooserId,
        attachedToPlayerId: playerId,
        permanentId,
        resolvedStepId: String(step.id || '').trim() || undefined,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist transformAttachToPlayerResolve event:', err);
    }
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${String(step.sourceName || 'Permanent')} becomes attached to ${getPlayerName(game, playerId)}.`,
      ts: Date.now(),
    });
    broadcastGame(io, game, gameId);
    debug(2, `[handleTransformAttachPlayerChoiceResponse] attach ${permanentId} to ${playerId}`);
  } catch (err) {
    debugError(1, '[handleTransformAttachPlayerChoiceResponse] Error:', err);
  }
  return true;
}
