/**
 * Per-object activated-keyword state. The key includes the chosen ability index
 * so multiple Exhaust abilities on one permanent remain independent.
 */
export function isExhaustAbilityText(text: unknown): boolean {
  return /^\s*exhaust\s*[—-]\s*/i.test(String(text || ''));
}

export function exhaustAbilityKey(permanentId: unknown, abilityIndex: unknown): string {
  return `${String(permanentId || '')}:${Math.max(0, Math.floor(Number(abilityIndex) || 0))}`;
}

export function hasActivatedExhaustAbility(state: any, permanentId: unknown, abilityIndex: unknown): boolean {
  return Boolean(state?.exhaustAbilitiesActivatedThisTurn?.[exhaustAbilityKey(permanentId, abilityIndex)]);
}

export function markExhaustAbilityActivated(state: any, permanentId: unknown, abilityIndex: unknown): void {
  if (!state || typeof state !== 'object') return;
  state.exhaustAbilitiesActivatedThisTurn = state.exhaustAbilitiesActivatedThisTurn || {};
  state.exhaustAbilitiesActivatedThisTurn[exhaustAbilityKey(permanentId, abilityIndex)] = true;
}

export function resetExhaustAbilityActivations(state: any): void {
  if (state && typeof state === 'object') {
    state.exhaustAbilitiesActivatedThisTurn = {};
  }
}
