/**
 * Planar die (Planechase).
 * Faces: chaos, planeswalk, and four blanks.
 * Public: rollPlanarDie, pickPlanarDieFace.
 */
import type { GameContext } from '../context.js';
import { applyPlanarDieFaces, queueIchorPlanarDiceIgnoreChoice } from './ichorPlanarDiceChoice.js';
import { ichorPlanarDiceAdjustment } from './replacementBatch98Collect.js';
import { applyPlanarDieFaceEffects, isPlanechaseEnabled } from './planechaseRuntime.js';

export type PlanarDieFace = 'chaos' | 'planeswalk' | 'blank';

const FACES: readonly PlanarDieFace[] = ['chaos', 'planeswalk', 'blank', 'blank', 'blank', 'blank'];

/** Pick a face without applying it, so callers can save the face before its effects run. */
export function pickPlanarDieFace(random: () => number = Math.random): PlanarDieFace {
  return FACES[Math.floor(random() * FACES.length)]!;
}

export function rollPlanarDie(
  ctx: GameContext,
  playerId: string,
  face?: PlanarDieFace,
): PlanarDieFace {
  const state = (ctx as any).state;
  const rolled = face && FACES.includes(face)
    ? face
    : FACES[Math.floor(Math.random() * FACES.length)]!;
  const ichor = ichorPlanarDiceAdjustment(state, playerId);
  const extraFaces: PlanarDieFace[] = [];
  if (ichor && ichor.extra > 0) {
    for (let i = 0; i < ichor.extra; i++) extraFaces.push(FACES[Math.floor(Math.random() * FACES.length)]!);
  }
  const faces: PlanarDieFace[] = [rolled, ...extraFaces];
  if (ichor && (ichor.extra > 0 || ichor.ignore > 0)) {
    // Ignore-one is a player choice; stash the faces and do not apply them yet.
    state.ichorPlanarDicePending = { playerId, ignore: ichor.ignore, faces };
  }
  if (ichor && ichor.ignore > 0) {
    queueIchorPlanarDiceIgnoreChoice(ctx);
    return rolled;
  }
  applyPlanarDieFaces(ctx, playerId, faces);
  if (isPlanechaseEnabled((ctx as any)?.state)) {
    applyPlanarDieFaceEffects(ctx, playerId, faces);
  }
  return rolled;
}
