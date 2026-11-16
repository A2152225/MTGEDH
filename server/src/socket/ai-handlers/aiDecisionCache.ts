/**
 * Origin: AI MAIN1 stall work — invalidate-on-change caches for decision hot paths.
 * Cluster: observation reuse (same seq) + sticky turn-plan order (same seat/step).
 * Public: aiCandidateStableKey, getCachedObservation, setCachedObservation,
 *   readStickyTurnPlanOrder, writeStickyTurnPlanOrder, getAvailableManaCached,
 *   getOrComputeSeqSeatModeCached, clearAIDecisionCachesForTests.
 *
 * Like the old canPlay/mana recompute bug: buildObservation + planTurn were redone on
 * every priority wake. Sticky order keeps the first plan's ranking for the rest of the
 * MAIN1/MAIN2 window; observation is cached while game.seq is unchanged.
 */

import type { Observation } from '../../../../rules-engine/src/ai/observation.js';
import type { AIActionCandidate } from './aiActionCandidateTypes.js';
import { mainPhaseWindowKey } from './aiMainPhaseActionBudget.js';

type ObsCacheEntry = {
  seq: number;
  seat: string;
  obs: Observation;
};

const obsByState = new WeakMap<object, ObsCacheEntry>();

type StickyTurnPlan = {
  windowKey: string;
  orderedKeys: string[];
};

function stickyMap(game: any): Record<string, StickyTurnPlan> {
  const state = game?.state as any;
  if (!state || typeof state !== 'object') return {};
  return (state._aiStickyTurnPlan ||= {}) as Record<string, StickyTurnPlan>;
}

/** Stable id for matching candidates across wakes (after a cast removes one). */
export function aiCandidateStableKey(c: AIActionCandidate): string {
  if (c.kind === 'cast_spell') {
    const id = String(c.spell?.card?.id || c.spell?.castCard?.id || '');
    const name = String(c.spell?.castCard?.name || c.spell?.card?.name || '');
    const zone = String(c.spell?.sourceZone || '');
    return `spell:${id || name}:${zone}`;
  }
  if (c.kind === 'cast_commander') {
    const id = String(c.commander?.card?.id || '');
    const name = String(c.commander?.card?.name || '');
    return `commander:${id || name}`;
  }
  if (c.kind === 'activate_ability') {
    const pid = String(c.ability?.action?.permanentId || '');
    const text = String(c.ability?.action?.abilityText || c.ability?.action?.cardName || '');
    return `activate:${pid}:${text.slice(0, 80)}`;
  }
  if (c.kind === 'play_land') {
    const id = String(c.land?.card?.id || '');
    return `land:${id}`;
  }
  return `other:${c.kind}`;
}

export function getCachedObservation(game: any, seat: string): Observation | null {
  const state = game?.state;
  if (!state || typeof state !== 'object') return null;
  const entry = obsByState.get(state);
  const seq = Number(game?.seq || 0) || 0;
  if (!entry || entry.seq !== seq || entry.seat !== String(seat)) return null;
  return entry.obs;
}

export function setCachedObservation(game: any, seat: string, obs: Observation): void {
  const state = game?.state;
  if (!state || typeof state !== 'object') return;
  obsByState.set(state, {
    seq: Number(game?.seq || 0) || 0,
    seat: String(seat),
    obs,
  });
}

export function readStickyTurnPlanOrder(game: any, playerId: string): string[] | null {
  const windowKey = mainPhaseWindowKey(game, playerId);
  const entry = stickyMap(game)[String(playerId)];
  if (!entry || entry.windowKey !== windowKey) return null;
  return Array.isArray(entry.orderedKeys) && entry.orderedKeys.length > 0
    ? entry.orderedKeys
    : null;
}

export function writeStickyTurnPlanOrder(
  game: any,
  playerId: string,
  orderedKeys: string[],
): void {
  const windowKey = mainPhaseWindowKey(game, playerId);
  stickyMap(game)[String(playerId)] = {
    windowKey,
    orderedKeys: orderedKeys.filter(Boolean),
  };
}

/**
 * Reorder candidates by a prior plan's key order. Unknown keys keep relative order at end.
 * Returns null if nothing matched (caller should run a fresh plan).
 */
export function reorderByStickyKeys(
  candidates: AIActionCandidate[],
  orderedKeys: readonly string[],
): AIActionCandidate[] | null {
  if (!orderedKeys.length || candidates.length === 0) return null;
  const byKey = new Map<string, AIActionCandidate[]>();
  for (const c of candidates) {
    const key = aiCandidateStableKey(c);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(c);
    else byKey.set(key, [c]);
  }
  const out: AIActionCandidate[] = [];
  const used = new Set<AIActionCandidate>();
  for (const key of orderedKeys) {
    const bucket = byKey.get(key);
    if (!bucket || bucket.length === 0) continue;
    const next = bucket.shift()!;
    out.push(next);
    used.add(next);
  }
  if (out.length === 0) return null;
  for (const c of candidates) {
    if (!used.has(c)) out.push(c);
  }
  return out;
}

/** Available-mana snapshot keyed by seat + game.seq (invalidate on any mutation). */
export function getAvailableManaCached(
  game: any,
  playerId: string,
  compute: () => Record<string, number>,
): Record<string, number> {
  const state = game?.state as any;
  if (!state || typeof state !== 'object') return compute();
  const seq = Number(game?.seq || 0) || 0;
  const key = `${String(playerId)}:${seq}`;
  const cache = (state._aiAvailableManaCache ||= {}) as Record<string, Record<string, number>>;
  if (cache[key]) return cache[key];
  const value = compute();
  cache[key] = value;
  // Keep only the current seq entries to avoid unbounded growth across a long game.
  for (const existing of Object.keys(cache)) {
    if (!existing.endsWith(`:${seq}`)) delete cache[existing];
  }
  return value;
}

type SeqSeatModeBucket<T> = {
  seq: number;
  byKey: Record<string, T>;
};

/**
 * Cache expensive castable-spell / commander scans for the same seat+seq+mode.
 * Priority wakes with no state change (same seq) used to re-walk hand × mana × canPlay.
 * Bucket is keyed by seat:mode so all four seats can hit within one seq.
 */
export function getOrComputeSeqSeatModeCached<T>(
  game: any,
  cacheProp: string,
  playerId: string,
  mode: string,
  compute: () => T,
): T {
  const state = game?.state as any;
  if (!state || typeof state !== 'object') return compute();
  const seq = Number(game?.seq || 0) || 0;
  const entryKey = `${String(playerId)}:${String(mode || '')}`;
  let bucket = state[cacheProp] as SeqSeatModeBucket<T> | undefined;
  if (!bucket || bucket.seq !== seq) {
    bucket = { seq, byKey: {} };
    state[cacheProp] = bucket;
  }
  if (Object.prototype.hasOwnProperty.call(bucket.byKey, entryKey)) {
    return bucket.byKey[entryKey];
  }
  const value = compute();
  bucket.byKey[entryKey] = value;
  return value;
}

export function clearAIDecisionCachesForTests(): void {
  // WeakMap entries drop with state GC; sticky/mana/spell caches live on state and are test-local.
}
