/**
 * socket/resolutionOptionChoiceSkipDrawReplacementHandlers.ts
 *
 * Origin parent: optionChoiceResponseHandlers (skip-draw OPTION_CHOICE).
 * Cluster: tryHandleSkipDrawReplacementChoice.
 * Public entry symbols: tryHandleSkipDrawReplacementChoice.
 * Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../state/resolution/index.js";
import { appendEvent } from "../db/index.js";
import { applySkipDrawReplacementChoice } from "../state/modules/zones-handlers/zonesDrawReplacementSkipDrawApply.js";
import { debugWarn } from "../utils/debug.js";
import { broadcastGame, emitToPlayer } from "./util.js";

function extractId(sel: any): string | null {
  if (typeof sel === 'string') return sel;
  if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
  if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
  return null;
}

export async function tryHandleSkipDrawReplacementChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepData = step as any;
  if (stepData.skipDrawReplacementChoice !== true) return false;

  const playerId = response.playerId;
  const rawChoiceId = String(extractId(response.selections) || 'draw').trim();
  const normalizedChoiceId = rawChoiceId.toLowerCase();
  const skipped = normalizedChoiceId === 'skip_draw' || normalizedChoiceId === 'skip';
  const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(stepData?.remainingDrawCountAfterChoice || 0)));
  const exceptKeywords = Array.isArray(stepData?.exceptKeywords) ? stepData.exceptKeywords : [];
  const resolvedStepId = String((step as any).id || '').trim();

  const result = applySkipDrawReplacementChoice(game as any, {
    playerId,
    choiceId: skipped ? 'skip_draw' : 'draw',
    remainingDrawCountAfterChoice,
    exceptKeywords,
    sourcePermanentId: String(stepData?.skipDrawSourcePermanentId || step.sourceId || '').trim(),
    sourceName: String(stepData?.skipDrawSourceName || step.sourceName || '').trim(),
  });

  if (!result.applied) {
    emitToPlayer(io, playerId as any, 'error', {
      code: 'SKIP_DRAW_REPLACEMENT_FAILED',
      message: 'Unable to apply skip-draw replacement choice.',
    });
    return true;
  }

  try {
    await appendEvent(gameId, (game as any).seq ?? 0, 'skipDrawReplacementResolve', {
      playerId,
      resolvedStepId,
      choiceId: skipped ? 'skip_draw' : 'draw',
      remainingDrawCountAfterChoice,
      exceptKeywords,
      sourcePermanentId: String(stepData?.skipDrawSourcePermanentId || step.sourceId || '').trim(),
      sourceName: String(stepData?.skipDrawSourceName || step.sourceName || '').trim(),
    });
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist skipDrawReplacementResolve event:', err);
  }

  broadcastGame(io, game, gameId);
  return true;
}
