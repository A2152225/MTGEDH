/**
 * socket/resolutionOptionChoiceOpponentLibraryDrawReplacementHandlers.ts
 *
 * Origin parent: optionChoiceResponseHandlers (opponent-library draw-replacement OPTION_CHOICE).
 * Cluster: tryHandleOpponentLibraryDrawReplacementChoice.
 * Public entry symbols: tryHandleOpponentLibraryDrawReplacementChoice.
 * Must not import resolution.ts.
 */

import type { Server } from 'socket.io';
import type { ResolutionStep, ResolutionStepResponse } from '../state/resolution/index.js';
import { appendEvent } from '../db/index.js';
import { applyOpponentLibraryDrawReplacementChoice } from '../state/modules/zones-handlers/zonesDrawReplacementOpponentLibraryExileApply.js';
import { debugWarn } from '../utils/debug.js';
import { broadcastGame, emitToPlayer } from './util.js';

function extractId(sel: any): string | null {
  if (typeof sel === 'string') return sel;
  if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
  if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
  return null;
}

export async function tryHandleOpponentLibraryDrawReplacementChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepData = step as any;
  if (stepData.opponentLibraryDrawReplacement !== true) return false;

  const playerId = response.playerId;
  const opponentId = String(extractId(response.selections) || '').trim();
  const allowed = Array.isArray(stepData?.options)
    ? stepData.options.map((option: any) => String(option?.id || '').trim()).filter(Boolean)
    : [];
  if (!opponentId || (allowed.length > 0 && !allowed.includes(opponentId))) {
    emitToPlayer(io, playerId as any, 'error', {
      code: 'INVALID_SELECTION',
      message: 'Must choose an opponent',
    });
    return true;
  }

  const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(stepData?.remainingDrawCountAfterChoice || 0)));
  const result = applyOpponentLibraryDrawReplacementChoice(game as any, {
    playerId,
    opponentId,
    remainingDrawCountAfterChoice,
    sourcePermanentId: String(stepData?.sourcePermanentId || step.sourceId || '').trim(),
    sourceName: String(step.sourceName || '').trim(),
  });

  if (!result.applied) {
    emitToPlayer(io, playerId as any, 'error', {
      code: 'OPPONENT_LIBRARY_DRAW_REPLACEMENT_FAILED',
      message: 'Unable to replace that draw.',
    });
    return true;
  }

  try {
    await appendEvent(gameId, (game as any).seq ?? 0, 'opponentLibraryDrawReplacementResolve', {
      playerId,
      opponentId,
      remainingDrawCountAfterChoice,
      sourcePermanentId: String(stepData?.sourcePermanentId || step.sourceId || '').trim(),
      sourceName: String(step.sourceName || '').trim(),
      resolvedStepId: String((step as any).id || '').trim(),
    });
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist opponentLibraryDrawReplacementResolve event:', err);
  }

  broadcastGame(io, game, gameId);
  return true;
}
