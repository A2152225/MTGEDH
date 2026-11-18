/**
 * Origin parent: aiActionCandidateHandlers.ts / aiPriorityHandlers.ts.
 *
 * Cluster: the AI's planar die special action. Once per turn, in the precombat main phase, and
 * only while the roll is free (CR 901.9: the first roll each turn costs {0}; later rolls are not
 * taken). The face, the cost and the per-turn counter are saved by performPlanarDieSpecialAction.
 *
 * Public: freePlanarDieRollCandidate, tryAIFreePlanarDieRoll.
 */
import type { Server } from 'socket.io';
import type { PlayerID } from '../../../../shared/src/types.js';
import { ResolutionQueueManager } from '../../state/resolution/ResolutionQueueManager.js';
import type { PlanarDieFace } from '../../state/modules/planarDie.js';
import {
  canTakePlanarDieAction,
  performPlanarDieSpecialAction,
  planarDieRollAnnouncement,
} from '../../state/modules/planarDieSpecialAction.js';
import { broadcastGame, getPlayerName } from '../util.js';
import type { AIActionCandidate } from './aiActionCandidateTypes.js';

/** Free roll in main phase 1, or null when the AI should not roll. */
export function freePlanarDieRollCandidate(state: any, playerId: string): AIActionCandidate | null {
  if (String(state?.step || '').toUpperCase() !== 'MAIN1') return null;
  const eligibility = canTakePlanarDieAction(state, playerId);
  if (!eligibility.ok || (eligibility.cost ?? 0) !== 0) return null;
  // Above casts (320–650) and below the separate land pass (1000), so the roll happens
  // after a land and before spells when it shares a candidate list.
  return { kind: 'roll_planar_die', priority: 900 };
}

/**
 * Roll once if the free main-phase-1 action is available. `face` is for tests; live calls omit it
 * and the die is random. Returns true when a roll was taken.
 */
export async function tryAIFreePlanarDieRoll(
  io: Server,
  game: any,
  gameId: string,
  playerId: PlayerID,
  options: { face?: PlanarDieFace } = {},
): Promise<boolean> {
  if (!freePlanarDieRollCandidate(game?.state, playerId)) return false;
  if (ResolutionQueueManager.getStepsForPlayer(gameId, playerId).length > 0) return false;

  const ctx = { ...game, gameId, state: game.state, io } as any;
  const result = performPlanarDieSpecialAction(ctx, playerId, options.face ? { face: options.face } : {});
  if (!result.ok) return false;

  const playerName = getPlayerName(game, playerId);
  try {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: planarDieRollAnnouncement(playerName, result),
      ts: Date.now(),
    });
  } catch {
    /* best-effort */
  }
  try {
    broadcastGame(io, game, gameId);
  } catch {
    /* best-effort */
  }
  return true;
}
