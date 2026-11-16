/**
 * socket/resolutionOptionChoicePursuitDrawReplacementHandlers.ts
 *
 * Origin parent: optionChoiceResponseHandlers (Pursuit of Knowledge OPTION_CHOICE).
 * Cluster: tryHandlePursuitDrawReplacementChoice.
 * Public entry symbols: tryHandlePursuitDrawReplacementChoice.
 * Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../state/resolution/index.js";
import { appendEvent } from "../db/index.js";
import { applyPursuitDrawReplacementChoice } from "../state/modules/zones-handlers/zonesDrawReplacementPursuitApply.js";
import { debugWarn } from "../utils/debug.js";
import { broadcastGame, emitToPlayer } from "./util.js";

function extractId(sel: any): string | null {
  if (typeof sel === 'string') return sel;
  if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
  if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
  return null;
}

export async function tryHandlePursuitDrawReplacementChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepData = step as any;
  if (stepData.pursuitDrawReplacementChoice !== true) return false;

  const playerId = response.playerId;
  const rawChoiceId = String(extractId(response.selections) || 'draw').trim();
  const normalizedChoiceId = rawChoiceId.toLowerCase();
  const putCounter = normalizedChoiceId === 'put_counter' || normalizedChoiceId === 'put-counter' || normalizedChoiceId === 'counter';
  const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(stepData?.remainingDrawCountAfterChoice || 0)));
  const counterType = String(stepData?.pursuitCounterType || 'study').trim() || 'study';
  const sourcePermanentId = String(stepData?.pursuitSourcePermanentId || step.sourceId || '').trim();
  const sourceName = String(stepData?.pursuitSourceName || step.sourceName || '').trim();
  const resolvedStepId = String((step as any).id || '').trim();

  const result = applyPursuitDrawReplacementChoice(game as any, {
    playerId,
    choiceId: putCounter ? 'put_counter' : 'draw',
    remainingDrawCountAfterChoice,
    sourcePermanentId,
    sourceName,
    counterType,
  });

  if (!result.applied) {
    emitToPlayer(io, playerId as any, 'error', {
      code: 'PURSUIT_DRAW_REPLACEMENT_FAILED',
      message: 'Unable to apply the study-counter draw replacement choice.',
    });
    return true;
  }

  try {
    await appendEvent(gameId, (game as any).seq ?? 0, 'pursuitDrawReplacementResolve', {
      playerId,
      resolvedStepId,
      choiceId: putCounter ? 'put_counter' : 'draw',
      remainingDrawCountAfterChoice,
      sourcePermanentId,
      sourceName,
      counterType,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist pursuitDrawReplacementResolve event:', err);
  }

  broadcastGame(io, game, gameId);
  return true;
}
