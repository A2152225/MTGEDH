/**
 * OPTION_CHOICE handler for Ichor Elixir: the player picks which extra
 * rolled planar face(s) to ignore, then the kept faces are applied.
 */
import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import {
  applyIchorPlanarDiceIgnoredIndexes,
  getIchorPlanarDicePending,
  parseIchorIgnoredFaceIndexes,
} from "../../state/modules/ichorPlanarDiceChoice.js";
import { broadcastGame } from "../util.js";

export async function tryHandleIchorPlanarDiceChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepData = step as any;
  if (stepData?.ichorPlanarDiceChoice !== true) return false;

  const pending = getIchorPlanarDicePending(game?.state);
  const faces = pending?.faces || (Array.isArray(stepData.ichorFaces) ? stepData.ichorFaces : []);
  const need = Math.min(
    Math.max(1, Math.floor(Number(stepData.ichorIgnoreCount || pending?.ignore || 1))),
    faces.length,
  );
  let ignored = parseIchorIgnoredFaceIndexes(response.selections, faces.length);
  if (ignored.length < need) {
    for (let index = faces.length - 1; index >= 0 && ignored.length < need; index--) {
      if (!ignored.includes(index)) ignored.push(index);
    }
  } else if (ignored.length > need) {
    ignored = ignored.slice(0, need);
  }

  const ctx = {
    gameId,
    state: game.state,
    bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : () => {},
    isReplaying: Boolean((game as any).isReplaying),
  } as any;
  applyIchorPlanarDiceIgnoredIndexes(ctx, ignored);
  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  try {
    broadcastGame(io, game, gameId);
  } catch { /* broadcast is best-effort in isolated tests */ }
  return true;
}
