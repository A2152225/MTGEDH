// server/src/state/modules/stormCastGrants.ts
// Prismari, the Inspiration: "Instant and sorcery spells you cast have storm."
// Public: getGrantedStormCountForCast, spellHasGrantedStorm.

const INSTANT_SORCERY_HAVE_STORM =
  /instant and sorcery spells you cast have storm/i;

function normalizeOracle(cardOrPerm: any): string {
  return String(
    cardOrPerm?.oracle_text
    || cardOrPerm?.oracleText
    || cardOrPerm?.card?.oracle_text
    || cardOrPerm?.card?.oracleText
    || '',
  );
}

function isInstantOrSorcery(card: any): boolean {
  const tl = String(card?.type_line || card?.typeLine || '').toLowerCase();
  return /\binstant\b/.test(tl) || /\bsorcery\b/.test(tl);
}

/** Number of storm instances granted by battlefield sources for this cast. */
export function getGrantedStormCountForCast(state: any, playerId: string, card: any): number {
  if (!isInstantOrSorcery(card)) return 0;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let count = 0;
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true) continue;
    if (String(perm.controller || '') !== String(playerId || '')) continue;
    if (INSTANT_SORCERY_HAVE_STORM.test(normalizeOracle(perm))) count += 1;
  }
  return count;
}

export function spellHasGrantedStorm(state: any, playerId: string, card: any): boolean {
  return getGrantedStormCountForCast(state, playerId, card) > 0;
}
