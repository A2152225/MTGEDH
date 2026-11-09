// server/src/state/modules/offBattlefieldFlashGrants.ts
// Teferi, Mage of Zhalfir: "Creature cards you own that aren't on the battlefield have flash."
// Public: oracleGrantsOwnedOffBattlefieldCreaturesFlash, cardHasGrantedOffBattlefieldFlash.

const GRANT_RE =
  /creature cards you own that aren'?t on the battlefield have flash/i;

function normalizeOracle(cardOrPerm: any): string {
  return String(
    cardOrPerm?.oracle_text
    || cardOrPerm?.oracleText
    || cardOrPerm?.card?.oracle_text
    || cardOrPerm?.card?.oracleText
    || '',
  );
}

export function oracleGrantsOwnedOffBattlefieldCreaturesFlash(oracle: string): boolean {
  return GRANT_RE.test(String(oracle || ''));
}

/** True when a creature card owned by playerId gets flash from a battlefield grantor. */
export function cardHasGrantedOffBattlefieldFlash(state: any, playerId: string, card: any): boolean {
  if (!card || typeof card === 'string') return false;
  if (!/\bcreature\b/i.test(String(card.type_line || card.typeLine || ''))) return false;
  const owner = String(card.owner || card.ownerId || playerId || '');
  if (owner && String(playerId || '') && owner !== String(playerId)) return false;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((perm) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '') !== String(playerId || '')) return false;
    return oracleGrantsOwnedOffBattlefieldCreaturesFlash(normalizeOracle(perm));
  });
}
