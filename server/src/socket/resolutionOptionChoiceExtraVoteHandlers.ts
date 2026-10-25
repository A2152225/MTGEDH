/**
 * socket/resolutionOptionChoiceExtraVoteHandlers.ts
 *
 * Origin parent: resolution-handlers/optionChoiceResponseHandlers.ts (OPTION_CHOICE flag extraVoteOffer).
 * Batch 29: "While voting, you may vote an additional time" (Ballot Broker, The Valeyard, Tivit).
 * Accept queues the stored VOTE step for the same player; decline continues the ballot without it.
 * Public entry symbols: tryHandleExtraVoteOfferChoice.
 * Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { ResolutionQueueManager, type ResolutionStep, type ResolutionStepResponse } from "../state/resolution/index.js";
import { continueVoteAfterSubmission } from "./resolutionVoteProliferateLimDulResponseHandlers.js";

function firstSelection(sel: unknown): string {
  const v = Array.isArray(sel) ? sel[0] : sel;
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') return String(Reflect.get(v, 'id') || Reflect.get(v, 'value') || '');
  return '';
}

export async function tryHandleExtraVoteOfferChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  if (Reflect.get(step, 'extraVoteOffer') !== true) return false;
  let nextVoteStep: any = {};
  try {
    nextVoteStep = JSON.parse(String(Reflect.get(step, 'extraVoteNextStepJson') || '{}')) || {};
  } catch {
    nextVoteStep = {};
  }
  const pid = String(response.playerId || nextVoteStep.playerId || '');
  if (firstSelection(response.selections) === 'vote_again') {
    ResolutionQueueManager.addStep(gameId, nextVoteStep);
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    return true;
  }
  const declined = Array.isArray(nextVoteStep.extraVoteDeclinedBy) ? nextVoteStep.extraVoteDeclinedBy : [];
  continueVoteAfterSubmission(io, game, gameId, { ...nextVoteStep, extraVoteDeclinedBy: [...declined, pid] }, pid, response);
  return true;
}
