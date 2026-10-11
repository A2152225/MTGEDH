/**
 * Planar die (Planechase).
 * Faces: chaos, planeswalk, and four blanks.
 * Public: rollPlanarDie.
 */

import type { GameContext } from '../context.js';
import { queueParsedKeywordAction } from './triggerEmissionFamilyUtils.js';

export type PlanarDieFace = 'chaos' | 'planeswalk' | 'blank';

const FACES: readonly PlanarDieFace[] = ['chaos', 'planeswalk', 'blank', 'blank', 'blank', 'blank'];

function activePlaneName(state: any): string {
  const plane = state?.activePlane || state?.currentPlane;
  return String(plane?.name || plane || '').trim().toLowerCase();
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
  const chaoticAether = activePlaneName(state) === 'chaotic aether';
  const chaos = rolled === 'chaos' || (chaoticAether && rolled === 'blank');
  state.planarDieRollsThisTurn = Array.isArray(state.planarDieRollsThisTurn) ? state.planarDieRollsThisTurn : [];
  state.planarDieRollsThisTurn.push({ playerId, face: rolled, chaos, ts: Date.now() });
  state.lastPlanarDieRoll = { playerId, face: rolled, chaos };
  queueParsedKeywordAction(ctx, playerId, 'roll_planar_die');
  if (chaos) queueParsedKeywordAction(ctx, playerId, 'chaos');
  return rolled;
}
