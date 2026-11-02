/**
 * socket/resolutionOptionChoiceRevealUntilKindDrawHandlers.ts
 *
 * B42: OPTION_CHOICE answer for the "you may instead choose land or nonland and reveal until" draw
 * replacement (Pavel Chekov, First Posting; Abundance).
 * Public entry symbols: tryHandleRevealUntilKindDrawChoice.
 * Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../state/resolution/index.js";
import { appendEvent } from "../db/index.js";
import {
  applyRevealUntilKindDrawChoice,
  REVEAL_UNTIL_KIND_DRAW_EVENT,
} from "../state/modules/zones-handlers/zonesDrawReplacementRevealUntilKind.js";
import { debugWarn } from "../utils/debug.js";
import { broadcastGame } from "./util.js";

function extractId(sel: any): string | null {
  if (typeof sel === 'string') return sel;
  if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
  if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
  return null;
}

export async function tryHandleRevealUntilKindDrawChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepData = step as any;
  if (stepData.revealUntilKindDrawChoice !== true) return false;
  const playerId = String(response.playerId || '');
  const choiceId = String(extractId(response.selections) || 'draw').trim().toLowerCase();
  const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(stepData?.remainingDrawCountAfterChoice || 0)));
  const sourceName = String(step.sourceName || '').trim();
  const result = applyRevealUntilKindDrawChoice(game as any, { playerId, choiceId, remainingDrawCountAfterChoice, sourceName });
  try {
    await appendEvent(gameId, (game as any).seq ?? 0, REVEAL_UNTIL_KIND_DRAW_EVENT, {
      playerId,
      resolvedStepId: String(stepData.id || '').trim(),
      choiceId: result.choiceId,
      remainingDrawCountAfterChoice,
      bottomOrderIds: result.bottomOrderIds || [],
      sourceName,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist revealUntilKindDrawReplacementResolve event:', err);
  }
  broadcastGame(io, game, gameId);
  return true;
}
