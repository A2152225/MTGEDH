// server/src/state/modules/opponentSorceryTimingLock.ts
// Batch 30: "Each opponent can cast spells only any time they could cast a sorcery."
// (Teferi, Time Raveler; Teferi, Mage of Zhalfir). Overrides flash / instant timing for affected players.
// Origin parent: socket/game-actions-handlers/gameActionsCastSpellFromHandForceFlash.ts (sorcery-timing gate).
// Public entry symbols: isCastingLimitedToSorceryTiming.

const LOCK_RE = /(?:each opponent|your opponents) can cast spells only any time they could cast a sorcery/;
const ALL_RE = /(?:each player|players) can cast spells only any time they could cast a sorcery/;

export function isCastingLimitedToSorceryTiming(state: any, playerId: string): boolean {
  const pid = String(playerId || '');
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    const text = String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'").toLowerCase();
    if (ALL_RE.test(text)) return true;
    if (LOCK_RE.test(text) && String(perm?.controller || '') !== pid) return true;
  }
  return false;
}
