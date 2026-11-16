/**
 * Per-object activated-keyword state. The key includes the chosen ability index
 * so multiple Exhaust abilities on one permanent remain independent.
 */
import { mayActivateExhaustAsThoughNotActivated, markExhaustActivatedThisTurn, markExhaustActivatedThisGame, hasExhaustBeenActivatedThisGame } from './batch92ExhaustReuse.js';

export function isExhaustAbilityText(text: unknown): boolean {
  return /^\s*exhaust\s*[—-]\s*/i.test(String(text || ''));
}

export function exhaustAbilityKey(permanentId: unknown, abilityIndex: unknown): string {
  return `${String(permanentId || '')}:${Math.max(0, Math.floor(Number(abilityIndex) || 0))}`;
}

export function hasActivatedExhaustAbility(state: any, permanentId: unknown, abilityIndex: unknown): boolean {
  const key = exhaustAbilityKey(permanentId, abilityIndex);
  const thisTurn = Boolean(state?.exhaustAbilitiesActivatedThisTurn?.[key]);
  const thisGame = hasExhaustBeenActivatedThisGame(state, String(permanentId || ''), key);
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const perm = battlefield.find((p: any) => String(p?.id || '') === String(permanentId || ''));
  const controller = String(perm?.controller || '');
  if (mayActivateExhaustAsThoughNotActivated(state, controller)) return thisTurn;
  return thisTurn || thisGame;
}

export function markExhaustAbilityActivated(state: any, permanentId: unknown, abilityIndex: unknown): void {
  if (!state || typeof state !== 'object') return;
  state.exhaustAbilitiesActivatedThisTurn = state.exhaustAbilitiesActivatedThisTurn || {};
  const key = exhaustAbilityKey(permanentId, abilityIndex);
  state.exhaustAbilitiesActivatedThisTurn[key] = true;
  markExhaustActivatedThisGame(state, String(permanentId || ''), key);
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const perm = battlefield.find((p: any) => String(p?.id || '') === String(permanentId || ''));
  if (perm && perm.controller) markExhaustActivatedThisTurn(state, String(perm.controller));
}

export function resetExhaustAbilityActivations(state: any): void {
  if (state && typeof state === 'object') {
    state.exhaustAbilitiesActivatedThisTurn = {};
  }
}
