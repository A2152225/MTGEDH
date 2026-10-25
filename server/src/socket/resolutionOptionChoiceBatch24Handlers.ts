/**
 * socket/resolutionOptionChoiceBatch24Handlers.ts
 *
 * Origin parent: optionChoiceResponseHandlers (Batch 24 OPTION_CHOICE flags).
 * Cluster: amplify reveal (amplifyRevealChoice) and Fasting-style optional draw-step skip
 * (optionalDrawStepSkipChoice).
 * Public entry symbols: tryHandleAmplifyRevealChoice, tryHandleOptionalDrawStepSkipChoice.
 * Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../state/resolution/index.js";
import { applyAmplifyReveal } from "../state/modules/amplifyEntry.js";
import { applyOptionalDrawStepSkipChoice } from "../state/modules/optionalDrawStepSkip.js";
import { broadcastGame } from "./util.js";

function selectionIds(sel: unknown): string[] {
  const list = Array.isArray(sel) ? sel : sel == null ? [] : [sel];
  return list
    .map((s: unknown) => {
      if (typeof s === 'string') return s;
      if (s && typeof s === 'object') return String(Reflect.get(s, 'id') || Reflect.get(s, 'value') || '');
      return '';
    })
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function tryHandleAmplifyRevealChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  if (Reflect.get(step, 'amplifyRevealChoice') !== true) return false;
  const permanentId = String(Reflect.get(step, 'amplifyPermanentId') || step.sourceId || '').trim();
  applyAmplifyReveal(game, permanentId, String(response.playerId), selectionIds(response.selections));
  broadcastGame(io, game, gameId);
  return true;
}

export async function tryHandleOptionalDrawStepSkipChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  if (Reflect.get(step, 'optionalDrawStepSkipChoice') !== true) return false;
  const permanentId = String(Reflect.get(step, 'optionalDrawStepSkipPermanentId') || step.sourceId || '').trim();
  const skip = selectionIds(response.selections)[0] === 'skip';
  applyOptionalDrawStepSkipChoice(game, permanentId, skip);
  broadcastGame(io, game, gameId);
  return true;
}
