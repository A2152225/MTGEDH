// rules-engine/src/optionalDrawStepSkipLife.ts
// Fasting: "If you would begin your draw step, you may skip that step instead. If you do, you gain N life."
// The server prompt stamps optionalDrawStepSkipTurn on the permanent; when executeDrawStep skips the
// step for that source, this grants the "if you do" life once per turn (optionalDrawStepSkipLifeTurn,
// the same marker the server path uses, so the two paths never double-grant). The gain runs through
// the registered life-gain replacement pipeline (Rhox Faithmender, Tainted Remedy, "can't gain life").
// Public entry symbols: applyOptionalDrawStepSkipLifeToState.

import type { GameState } from '../../shared/src';
import { getCombinedPermanentText } from './permanentText';
import { resolveLifeGainDeltaFromHook } from './lifeGainReplacementHook';

const LIFE_RE = /\bskip that step instead\.\s*if you do, you gain (\d+) life\b/i;

export function applyOptionalDrawStepSkipLifeToState(
  state: GameState,
  activePlayerId: string,
): { state: GameState; gained: number; logs: string[] } {
  const turn = Number(Reflect.get(state, 'turnNumber') ?? Reflect.get(state, 'turn') ?? 0) || 0;
  const logs: string[] = [];
  let gained = 0;
  const battlefield = (state.battlefield || []).map((perm: any) => {
    if (!perm || String(perm.controller || '') !== activePlayerId) return perm;
    if (Number(perm.optionalDrawStepSkipTurn) !== turn || Number(perm.optionalDrawStepSkipLifeTurn) === turn) return perm;
    const m = getCombinedPermanentText(perm).replace(/\u2019/g, "'").match(LIFE_RE);
    if (!m) return perm;
    const amount = Number(m[1]) || 0;
    gained += amount;
    logs.push(`${activePlayerId} gains ${amount} life (${String(perm?.card?.name || 'skip draw step')})`);
    return { ...perm, optionalDrawStepSkipLifeTurn: turn };
  });
  if (gained <= 0) return { state, gained: 0, logs };
  const delta = resolveLifeGainDeltaFromHook(state, activePlayerId, gained);
  if (delta !== gained) logs.push(`life gain replaced: ${gained} -> ${delta}`);
  gained = delta;
  const players = (state.players || []).map((p: any) =>
    p && p.id === activePlayerId ? { ...p, life: (Number(p.life) || 0) + gained } : p);
  const next: any = { ...state, battlefield, players };
  const lifeMap = Reflect.get(state, 'life');
  if (lifeMap && typeof lifeMap === 'object' && activePlayerId in lifeMap) {
    next.life = { ...lifeMap, [activePlayerId]: (Number(lifeMap[activePlayerId]) || 0) + gained };
  }
  return { state: next, gained, logs };
}
