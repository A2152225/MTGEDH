// server/src/state/modules/batch93AttackRestrictions.ts
// B93: "Creatures that attacked during their controller's last turn can't attack."
// Public: parseBatch93HallsOfMistSentence, hallsOfMistPreventsAttack,
// rememberAttackersThisTurn, rotateAttackedLastTurnForController.

import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const HALLS_RE = /creatures that attacked during their controller's last turn can't attack/i;

export function parseBatch93HallsOfMistSentence(oracle: string): boolean {
  return HALLS_RE.test(normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'"));
}

export function hallsOfMistEffectIsActive(state: any): boolean {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((p: any) => p && p.phasedOut !== true && p.card && parseBatch93HallsOfMistSentence(readCardOracleText(p.card)));
}

export function rememberAttackersThisTurn(state: any, attackerIds: string[]): void {
  if (!state) return;
  state.creaturesThatAttackedThisTurn = state.creaturesThatAttackedThisTurn || {};
  for (const id of attackerIds) {
    const key = String(id || '').trim();
    if (key) state.creaturesThatAttackedThisTurn[key] = true;
  }
}

/** Call at the start of `playerId`'s turn: last turn's attackers become "attacked last turn" for that controller. */
export function rotateAttackedLastTurnForController(state: any, playerId: string): void {
  if (!state) return;
  const pid = String(playerId || '');
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const thisTurn = state.creaturesThatAttackedThisTurn || {};
  state.creaturesThatAttackedDuringControllersLastTurn = state.creaturesThatAttackedDuringControllersLastTurn || {};
  const last = state.creaturesThatAttackedDuringControllersLastTurn as Record<string, boolean>;
  for (const perm of battlefield) {
    const id = String(perm?.id || '');
    if (!id || String(perm?.controller || '') !== pid) continue;
    delete last[id];
  }
  for (const id of Object.keys(thisTurn)) {
    const perm = battlefield.find((p: any) => String(p?.id || '') === id);
    if (perm && String(perm.controller || '') === pid) last[id] = true;
    delete thisTurn[id];
  }
  // Also drop last-turn flags for this controller's creatures that did not attack.
}

export function hallsOfMistPreventsAttack(state: any, permanentId: string): boolean {
  if (!hallsOfMistEffectIsActive(state)) return false;
  const id = String(permanentId || '');
  return Boolean(state?.creaturesThatAttackedDuringControllersLastTurn?.[id]);
}
