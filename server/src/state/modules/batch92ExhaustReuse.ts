// server/src/state/modules/batch92ExhaustReuse.ts
// B92: "During your turn, as long as you haven't activated an exhaust ability
// this turn, you may activate exhaust abilities as though they haven't been
// activated." Pair with persistent once-per-game exhaust tracking (the engine
// previously reset exhaust each turn, which would make this a no-op).
// Public: parseBatch92ExhaustReuseSentence, collectBatch92ExhaustReuseSpecs,
// mayActivateExhaustAsThoughNotActivated, shouldPersistExhaustActivation,
// isExhaustActivatedThisTurn, markExhaustActivatedThisTurn, resetExhaustActivatedThisTurn.

import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const REUSE_RE =
  /during your turn, as long as you haven't activated an exhaust ability this turn, you may activate exhaust abilities as though they haven't been activated/i;

export function parseBatch92ExhaustReuseSentence(oracle: string): boolean {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  return REUSE_RE.test(text);
}

export function collectBatch92ExhaustReuseSpecs(state: any): Array<{ sourcePermanentId: string; sourceController: string; sourceName: string }> {
  const out: Array<{ sourcePermanentId: string; sourceController: string; sourceName: string }> = [];
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true || !perm.card) continue;
    if (!parseBatch92ExhaustReuseSentence(readCardOracleText(perm.card))) continue;
    const sourcePermanentId = String(perm.id || '').trim();
    const sourceController = String(perm.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    out.push({ sourcePermanentId, sourceController, sourceName: String(perm.card?.name || 'Unknown').trim() });
  }
  return out;
}

export function mayActivateExhaustAsThoughNotActivated(state: any, playerId: string): boolean {
  const pid = String(playerId || '');
  if (!pid) return false;
  const active = String(state?.activePlayer || state?.turnPlayer || state?.priorityPlayer || '');
  // "During your turn" — require the player to be the turn player when known.
  const turnPlayer = String(state?.turnPlayerId || state?.activePlayerId || state?.currentTurnPlayerId || active);
  if (turnPlayer && turnPlayer !== pid) return false;
  const has = collectBatch92ExhaustReuseSpecs(state).some((s) => s.sourceController === pid);
  if (!has) return false;
  if (isExhaustActivatedThisTurn(state, pid)) return false;
  return true;
}

export function shouldPersistExhaustActivation(): boolean {
  return true;
}

function bucket(state: any): Record<string, boolean> {
  if (!state) return {};
  if (!state.exhaustAbilityActivatedByPlayerThisTurn || typeof state.exhaustAbilityActivatedByPlayerThisTurn !== 'object') {
    state.exhaustAbilityActivatedByPlayerThisTurn = {};
  }
  return state.exhaustAbilityActivatedByPlayerThisTurn as Record<string, boolean>;
}

export function isExhaustActivatedThisTurn(state: any, playerId: string): boolean {
  const rec = bucket(state);
  return rec[String(playerId || '')] === true || rec[`${playerId}:any`] === true;
}

export function markExhaustActivatedThisTurn(state: any, playerId: string): void {
  if (!state || !playerId) return;
  const rec = bucket(state);
  rec[String(playerId)] = true;
}

export function resetExhaustActivatedThisTurn(state: any): void {
  if (!state) return;
  state.exhaustAbilityActivatedByPlayerThisTurn = {};
}

/** Persistent once-per-game flag. Keyed by permanent id + ability text. */
export function hasExhaustBeenActivatedThisGame(state: any, permanentId: string, abilityText?: string): boolean {
  const map = state?.exhaustAbilitiesActivatedThisGame;
  if (!map || typeof map !== 'object') return false;
  const key = abilityText ? `${permanentId}::${String(abilityText).slice(0, 80)}` : String(permanentId);
  // With an ability key only that ability counts; the permanent-wide flag is for callers without one.
  return abilityText ? map[key] === true : map[String(permanentId)] === true;
}

export function markExhaustActivatedThisGame(state: any, permanentId: string, abilityText?: string): void {
  if (!state || !permanentId) return;
  if (!state.exhaustAbilitiesActivatedThisGame || typeof state.exhaustAbilitiesActivatedThisGame !== 'object') {
    state.exhaustAbilitiesActivatedThisGame = {};
  }
  const key = abilityText ? `${permanentId}::${String(abilityText).slice(0, 80)}` : String(permanentId);
  state.exhaustAbilitiesActivatedThisGame[key] = true;
  state.exhaustAbilitiesActivatedThisGame[String(permanentId)] = true;
}
