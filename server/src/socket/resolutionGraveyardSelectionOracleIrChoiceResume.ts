/**
 * socket/resolutionGraveyardSelectionOracleIrChoiceResume.ts
 *
 * Oracle-IR choice-step early-return for GRAVEYARD_SELECTION prompts that were
 * queued from move_zone (graveyard-origin) instead of LIBRARY_SEARCH.
 * Mirrors the oracleIrChoiceStepJson early path in playerChoiceResponseHandlers.
 */

import type { Server } from 'socket.io';
import {
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
  syncAllOracleIRPlayerZonesAfterResolution,
} from '../state/modules/oracleIrServerZoneSync.js';
import type { ResolutionStep, ResolutionStepResponse } from '../state/resolution/index.js';
import { debug } from '../utils/debug.js';
import { broadcastGame } from './util.js';

/**
 * @returns true when oracleIrChoiceStepJson was present and IR consumed the response
 * (caller must not run legacy graveyard move logic).
 */
export async function tryHandleGraveyardSelectionOracleIrChoiceResume(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepData = step as any;
  if (!String(stepData?.oracleIrChoiceStepJson || '').trim()) {
    return false;
  }

  const ctx = ((game as any).ctx || game) as any;
  ctx.gameId = gameId;
  ctx.state = game.state;

  if (response.cancelled) {
    debug(2, `[Resolution] GRAVEYARD_SELECTION oracle-IR choice cancelled for ${String(step.sourceName || '')}`);
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, step, response);
  if (resumed === null) {
    return false;
  }

  maybeResumeOracleIRStepsAfterResolution(ctx, step);
  game.state = ctx.state;
  syncAllOracleIRPlayerZonesAfterResolution(ctx);
  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  broadcastGame(io, game, gameId);
  return true;
}
