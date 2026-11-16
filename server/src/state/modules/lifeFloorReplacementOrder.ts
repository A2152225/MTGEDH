/**
 * CR 616.1 order prompt when two or more life-floor replacements would
 * apply at once (Enduring Angel family, and any collected life-floor
 * transform specs). Public: listLifeFloorReplacementCandidates,
 * queueLifeFloorReplacementOrderIfNeeded, applyLifeFloorReplacementAfterChoice,
 * LIFE_FLOOR_REPLACEMENT_ORDER_FLAG.
 */
import type { PlayerID } from '../../../../shared/src/types.js';
import { uid } from '../utils.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { ResolutionStepType } from '../resolution/types.js';
import {
  applyEnduringAngelLifeFloor,
  parseEnduringAngelLifeFloor,
} from './batch99LifeFloorTransform.js';

export const LIFE_FLOOR_REPLACEMENT_ORDER_FLAG = 'lifeFloorReplacementOrderChoice';

export interface LifeFloorReplacementCandidate {
  id: string;
  effectId: string;
  sourceName: string;
  sourcePermanentId: string;
  description: string;
  life: number;
}

export function listLifeFloorReplacementCandidates(state: any, playerId: string): LifeFloorReplacementCandidate[] {
  const pid = String(playerId || '').trim();
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const out: LifeFloorReplacementCandidate[] = [];
  const seen = new Set<string>();
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true) continue;
    if (String(perm.controller || '') !== pid) continue;
    const parsed = parseEnduringAngelLifeFloor(perm?.card?.oracle_text || perm?.oracle_text || '');
    if (!parsed) continue;
    const sourcePermanentId = String(perm.id || '').trim();
    if (!sourcePermanentId || seen.has(sourcePermanentId)) continue;
    seen.add(sourcePermanentId);
    const sourceName = String(perm.card?.name || perm.name || 'Enduring Angel');
    out.push({
      id: `${sourcePermanentId}:life-floor-transform`,
      effectId: 'life-floor-transform',
      sourceName,
      sourcePermanentId,
      life: parsed.life,
      description: `${sourceName}: if your life total would be reduced to 0 or less, transform this and your life total becomes ${parsed.life}.`,
    });
  }
  return out;
}

export function queueLifeFloorReplacementOrderIfNeeded(args: {
  ctx: { state: any; gameId?: string; isReplaying?: boolean };
  playerId: string;
  currentLife: number;
  lossAmount: number;
}): { queued: boolean; candidates: LifeFloorReplacementCandidate[] } {
  const candidates = listLifeFloorReplacementCandidates(args.ctx.state, args.playerId);
  if (candidates.length < 2) return { queued: false, candidates };
  const gameId = String((args.ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (args.ctx as any).isReplaying) {
    return { queued: false, candidates };
  }
  const existing = ResolutionQueueManager
    .getStepsForPlayer(gameId, args.playerId as PlayerID)
    .some((step: any) => step?.[LIFE_FLOOR_REPLACEMENT_ORDER_FLAG] === true);
  if (existing) return { queued: true, candidates };

  ResolutionQueueManager.addStep(gameId, {
    id: uid('life_floor_repl_order'),
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: args.playerId as PlayerID,
    sourceId: candidates[0].sourcePermanentId,
    sourceName: 'Replacement order',
    description: 'Choose which life-floor replacement to apply first (CR 616.1).',
    mandatory: true,
    minSelections: 1,
    maxSelections: 1,
    [LIFE_FLOOR_REPLACEMENT_ORDER_FLAG]: true,
    lifeFloorPlayerId: args.playerId,
    lifeFloorCurrentLife: Math.floor(Number(args.currentLife) || 0),
    lifeFloorLossAmount: Math.max(0, Math.floor(Number(args.lossAmount) || 0)),
    options: candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.sourceName,
      description: candidate.description,
    })),
    lifeFloorReplacementCandidates: candidates,
  } as any);
  return { queued: true, candidates };
}

export function applyLifeFloorReplacementAfterChoice(args: {
  ctx: { state: any };
  playerId: string;
  currentLife: number;
  lossAmount: number;
  chosenId: string;
}): ReturnType<typeof applyEnduringAngelLifeFloor> {
  const candidates = listLifeFloorReplacementCandidates(args.ctx.state, args.playerId);
  const chosen = candidates.find((candidate) => candidate.id === args.chosenId || candidate.sourcePermanentId === args.chosenId)
    || candidates[0];
  return applyEnduringAngelLifeFloor(
    args.ctx,
    args.playerId,
    args.currentLife,
    args.lossAmount,
    chosen?.sourcePermanentId,
  );
}

/**
 * Apply a single floor immediately, or queue the CR 616.1 prompt when two or
 * more life-floor replacements would apply. Callers must not write the lethal
 * life total when `queued` is true.
 */
export function applyEnduringAngelLifeFloorOrQueueOrder(
  ctx: { state?: any; gameId?: string; isReplaying?: boolean } | undefined,
  playerId: string,
  currentLife: number,
  lossAmount: number,
): ReturnType<typeof applyEnduringAngelLifeFloor> & { queued?: boolean } {
  const state = (ctx as any)?.state || ctx;
  const current = Number.isFinite(currentLife) ? currentLife : 0;
  const loss = Math.max(0, Number(lossAmount) || 0);
  if (loss <= 0 || current - loss > 0) {
    return { applied: false, nextLife: current - loss, transformed: false, lostGame: false };
  }
  const candidates = listLifeFloorReplacementCandidates(state, playerId);
  if (candidates.length >= 2) {
    const queued = queueLifeFloorReplacementOrderIfNeeded({
      ctx: ctx as any,
      playerId,
      currentLife: current,
      lossAmount: loss,
    });
    if (queued.queued) {
      return { applied: false, nextLife: current, transformed: false, lostGame: false, queued: true };
    }
  }
  return applyEnduringAngelLifeFloor(ctx as any, playerId, current, loss);
}
