/**
 * socket/resolutionReplacementOrderResponseHandlers.ts
 *
 * OPTION_CHOICE response for CR 616.1 replacement-order prompts
 * (replacementOrderChoice). Public: handleReplacementOrderChoiceResponse.
 */

import type { Server } from 'socket.io';
import { appendEvent } from '../db/index.js';
import { debug, debugWarn, debugError } from '../utils/debug.js';
import { broadcastGame, getPlayerName } from './util.js';
import { applyReplacementOrderChoiceOnContext } from '../state/modules/replacementOrderChoiceApply.js';

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

export async function handleReplacementOrderChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: any,
  response: any,
): Promise<boolean> {
  if (!step || step.replacementOrderChoice !== true) return false;
  const playerId = String(step.playerId || response?.playerId || '').trim();
  if (!playerId) return true;

  const candidates = Array.isArray(step.replacementOrderCandidates) ? step.replacementOrderCandidates : [];
  let choiceId = firstId(response?.selections);
  if (response?.cancelled || !choiceId) {
    choiceId = String(candidates[0]?.id || '').trim();
  }
  if (!choiceId) return true;

  try {
    const result = applyReplacementOrderChoiceOnContext(game, {
      playerId,
      choiceId,
      eventKind: step.replacementOrderEventKind,
      candidates,
      remainingDrawCountAfterChoice: Number(step.remainingDrawCountAfterChoice || 0),
      tokenCreate: step.replacementOrderTokenCreate,
    });

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'replacementOrderChoiceResolve', {
        playerId,
        resolvedStepId: String(step.id || '').trim() || undefined,
        choiceId: result.choiceId || choiceId,
        eventKind: step.replacementOrderEventKind,
        remainingDrawCountAfterChoice: Number(step.remainingDrawCountAfterChoice || 0),
        tokenCreate: step.replacementOrderTokenCreate
          ? JSON.parse(JSON.stringify(step.replacementOrderTokenCreate))
          : undefined,
        candidates,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist replacementOrderChoiceResolve event:', err);
    }

    const chosen = candidates.find((c: any) => c.id === (result.choiceId || choiceId));
    const sourceName = String(chosen?.sourceName || 'a replacement effect');
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} applies ${sourceName} first.`,
      ts: Date.now(),
    });
    broadcastGame(io, game, gameId);
    debug(2, `[handleReplacementOrderChoiceResponse] ${playerId} chose ${choiceId}`);
  } catch (err) {
    debugError(1, '[handleReplacementOrderChoiceResponse] Error:', err);
  }
  return true;
}
