// server/src/state/modules/gyLoseAllAbilitiesStatic.ts
// B63: Yixlid Jailer ? "Cards in graveyards lose all abilities."
// Public: oracleHasGyLoseAllAbilities, gyLoseAllAbilitiesActive, applyGyLoseAllAbilitiesOverlay.

const LINE_RE = /cards in graveyards lose all abilities/i;

export function oracleHasGyLoseAllAbilities(oracle: string): boolean {
  return LINE_RE.test(String(oracle || ''));
}

export function gyLoseAllAbilitiesActive(state: any): boolean {
  const board = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of board) {
    if (!perm || perm.phasedOut) continue;
    if (oracleHasGyLoseAllAbilities(String(perm.card?.oracle_text || ''))) return true;
  }
  return false;
}

/** Best-effort: strip oracle_text / abilities when reading a card while the static applies. */
export function applyGyLoseAllAbilitiesOverlay(card: any, state: any): any {
  if (!card || !gyLoseAllAbilitiesActive(state)) return card;
  if (card.oracle_text === '' && (!Array.isArray(card.abilities) || card.abilities.length === 0)) return card;
  return {
    ...card,
    oracle_text: '',
    abilities: [],
    keywords: [],
    gyLoseAllAbilities: true,
  };
}
