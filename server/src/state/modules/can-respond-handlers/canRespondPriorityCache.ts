// server/src/state/modules/can-respond-handlers/canRespondPriorityCache.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster: per-state-seq cache for getCastableSpellCandidates / canRespond / canAct.
// Public entry symbols: getOrComputeCachedBoolean, getOrComputeCachedSpellCandidates.
//
// One priority pass calls canRespond and getCastableSpellCandidates many times for the
// same player (autoPassLoop, tryAIResponseActions, playable-card ids). Cache by a cheap
// fingerprint of seq / phase / stack / attackers / own taps / mana / hand size.

import type { GameContext } from '../../context.js';
import type { PlayerID } from '../../../../../shared/src/index.js';
import type { SharedSpellCastCandidate } from './canRespondTypes.js';

type CacheBucket = {
  fingerprint: string;
  values: Map<string, unknown>;
};

const cacheByState = new WeakMap<object, CacheBucket>();

function buildGlobalFingerprint(ctx: GameContext): string {
  const state = (ctx as any)?.state || {};
  const seq = Number((ctx as any)?.seq?.value ?? state.seq ?? 0);
  const stack = Array.isArray(state.stack) ? state.stack : [];
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const attackingIds: string[] = [];
  const tappedIds: string[] = [];
  for (const permanent of battlefield) {
    const id = String(permanent?.id || '');
    if (!id) continue;
    if (permanent?.attacking || permanent?.isAttacking) attackingIds.push(id);
    if (permanent?.tapped) tappedIds.push(id);
  }
  const tempGrants = Array.isArray(state.temporaryGraveyardKeywordGrants)
    ? String(state.temporaryGraveyardKeywordGrants.length)
    : '0';
  const stackTop = stack.length > 0 ? String(stack[stack.length - 1]?.id || '') : '';
  return [
    seq,
    String(state.phase || ''),
    String(state.step || ''),
    String(state.turnPlayer || ''),
    stack.length,
    stackTop,
    battlefield.length,
    attackingIds.join(','),
    tappedIds.join(','),
    tempGrants,
  ].join('|');
}

function buildPlayerFingerprint(ctx: GameContext, playerId: PlayerID): string {
  const state = (ctx as any)?.state || {};
  const hand = state.zones?.[playerId]?.hand;
  const graveyard = state.zones?.[playerId]?.graveyard;
  const exile = state.zones?.[playerId]?.exile;
  const library = state.zones?.[playerId]?.library;
  const gyKey = Array.isArray(graveyard) ? graveyard.map((card: any) => String(card?.id || '')).join(',') : '';
  const exileKey = Array.isArray(exile) ? exile.map((card: any) => String(card?.id || '')).join(',') : '';
  const libraryTop = Array.isArray(library) && library.length > 0 ? String(library[0]?.id || '') : '';
  const gyCasted = state.castFromGraveyardThisTurn?.[playerId] ? '1' : '0';
  const gyPerms = Array.isArray(state.graveyardCastingPermissions)
    ? state.graveyardCastingPermissions
      .filter((entry: any) => String(entry?.playerId || '') === String(playerId))
      .map((entry: any) => `${String(entry?.id || '')}:${String(entry?.usedCount ?? entry?.uses ?? '')}`)
      .join(',')
    : '';
  const pool = state.manaPool?.[playerId]
    || (Array.isArray(state.players) ? state.players.find((p: any) => String(p?.id) === String(playerId))?.manaPool : undefined);
  const poolKey = pool
    ? [pool.white || 0, pool.blue || 0, pool.black || 0, pool.red || 0, pool.green || 0, pool.colorless || 0].join(',')
    : '';
  return [
    Array.isArray(hand) ? hand.length : 0,
    gyKey,
    exileKey,
    libraryTop,
    gyCasted,
    gyPerms,
    poolKey,
  ].join('|');
}

function getBucket(ctx: GameContext): CacheBucket | null {
  const state = (ctx as any)?.state;
  if (!state || typeof state !== 'object') return null;
  const fingerprint = buildGlobalFingerprint(ctx);
  let bucket = cacheByState.get(state);
  if (!bucket || bucket.fingerprint !== fingerprint) {
    bucket = { fingerprint, values: new Map() };
    cacheByState.set(state, bucket);
  }
  return bucket;
}

function cacheKey(ctx: GameContext, playerId: PlayerID, kind: string, optionKey: string): string {
  return `${String(playerId)}:${buildPlayerFingerprint(ctx, playerId)}:${kind}:${optionKey}`;
}

export function getOrComputeCachedBoolean(
  ctx: GameContext,
  playerId: PlayerID,
  kind: string,
  compute: () => boolean,
): boolean {
  const bucket = getBucket(ctx);
  if (!bucket) return compute();
  const key = cacheKey(ctx, playerId, kind, '');
  if (bucket.values.has(key)) {
    return bucket.values.get(key) as boolean;
  }
  const value = compute();
  bucket.values.set(key, value);
  return value;
}

export function getOrComputeCachedSpellCandidates(
  ctx: GameContext,
  playerId: PlayerID,
  optionKey: string,
  compute: () => SharedSpellCastCandidate[],
): SharedSpellCastCandidate[] {
  const bucket = getBucket(ctx);
  if (!bucket) return compute();
  const key = cacheKey(ctx, playerId, 'spells', optionKey);
  if (bucket.values.has(key)) {
    return (bucket.values.get(key) as SharedSpellCastCandidate[]).slice();
  }
  const value = compute();
  bucket.values.set(key, value);
  return value.slice();
}
