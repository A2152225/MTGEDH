// server/src/state/modules/batch99LifeFloorTransform.ts
// Enduring Angel family: "If your life total would be reduced to 0 or less,
// instead transform this creature and your life total becomes 3. Then if this
// creature didn't transform this way, you lose the game."
// Public: parseEnduringAngelLifeFloor, applyEnduringAngelLifeFloor.

import type { GameContext } from './context.js';
import { transformPermanentToFace } from './day-night.js';

function normalizeOracle(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

export function parseEnduringAngelLifeFloor(oracle: string): { life: number } | null {
  const text = normalizeOracle(oracle);
  const match = text.match(
    /if your life total would be reduced to 0 or less, instead transform this creature and your life total becomes (\d+)/i,
  );
  if (!match) return null;
  const life = Math.max(0, Math.floor(Number(match[1]) || 0));
  return { life };
}

function readLife(state: any, playerId: string): number {
  const starting = Number(state?.startingLife ?? 40);
  const player = (Array.isArray(state?.players) ? state.players : []).find(
    (entry: any) => String(entry?.id || '') === String(playerId),
  );
  return Number(state?.life?.[playerId] ?? player?.life ?? starting);
}

function writeLife(state: any, playerId: string, next: number): void {
  if (!state) return;
  state.life = state.life || {};
  state.life[playerId] = next;
  const player = (Array.isArray(state.players) ? state.players : []).find(
    (entry: any) => String(entry?.id || '') === String(playerId),
  );
  if (player) player.life = next;
}

function markPlayerHasLost(state: any, ctx: GameContext | undefined, playerId: string, reason: string): void {
  const player = (Array.isArray(state?.players) ? state.players : []).find(
    (entry: any) => String(entry?.id || '') === String(playerId),
  );
  if (player) {
    player.hasLost = true;
    player.lostReason = reason;
    player.lossReason = reason;
  }
  void ctx;
}

function tryTransformSource(perm: any, ctx: GameContext | undefined): boolean {
  const card: any = perm?.card;
  const faces: any[] = Array.isArray(card?.card_faces) ? card.card_faces : [];
  if (faces.length < 2) return false;
  if (perm.transformed === true) return false;
  const before = perm.transformed === true;
  try {
    transformPermanentToFace(perm, 1, ctx);
  } catch {
    return false;
  }
  return perm.transformed === true && before === false;
}

export interface EnduringAngelLifeFloorResult {
  applied: boolean;
  nextLife: number;
  transformed: boolean;
  lostGame: boolean;
}

/**
 * If `lossAmount` would reduce `playerId`'s life to 0 or less, apply the
 * first matching source: set life to the printed total (default 3), try to
 * transform that source, and lose the game if it did not transform.
 * When applied, this function already writes the new life total.
 */
export function applyEnduringAngelLifeFloor(
  ctx: GameContext | { state?: any } | undefined,
  playerId: string,
  currentLife: number,
  lossAmount: number,
  sourcePermanentId?: string,
): EnduringAngelLifeFloorResult {
  const state = (ctx as any)?.state || ctx;
  const current = Number.isFinite(currentLife) ? currentLife : readLife(state, playerId);
  const loss = Math.max(0, Number(lossAmount) || 0);
  const wouldBe = current - loss;
  if (loss <= 0 || wouldBe > 0 || !state) {
    return { applied: false, nextLife: wouldBe, transformed: false, lostGame: false };
  }
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const source = battlefield.find((perm) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '') !== String(playerId)) return false;
    if (sourcePermanentId && String(perm.id || '') !== String(sourcePermanentId)) return false;
    return !!parseEnduringAngelLifeFloor(perm?.card?.oracle_text || perm?.oracle_text || '');
  });
  if (!source) {
    return { applied: false, nextLife: wouldBe, transformed: false, lostGame: false };
  }
  const parsed = parseEnduringAngelLifeFloor(source.card?.oracle_text || source.oracle_text || '');
  const nextLife = parsed ? parsed.life : 3;
  const transformed = tryTransformSource(source, ctx as GameContext | undefined);
  writeLife(state, playerId, nextLife);
  const lostGame = !transformed;
  if (lostGame) {
    const name = String(source.card?.name || 'This creature');
    markPlayerHasLost(state, ctx as GameContext | undefined, playerId, `${name} did not transform this way`);
  }
  return { applied: true, nextLife, transformed, lostGame };
}
