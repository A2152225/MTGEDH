// server/src/state/modules/graveyardScavengeGrants.ts
// Varolz, the Scar-Striped / Young Deathclaws: "Each creature card in your graveyard has scavenge.
// The scavenge cost is equal to its mana cost." A battlefield grant of scavenge to graveyard cards.
// Public entry symbols: oracleGrantsGraveyardScavenge, cardHasPrintedScavenge, getGrantedScavengeCost.

const GRANT_RE = /\beach creature card in your graveyard has scavenge\. the scavenge cost is equal to its mana cost\b/;

function lowerOracle(card: any): string {
  return String(card?.oracle_text || '').toLowerCase().replace(/\u2019/g, "'");
}

export function oracleGrantsGraveyardScavenge(oracle: string): boolean {
  return GRANT_RE.test(String(oracle || '').toLowerCase().replace(/\u2019/g, "'"));
}

export function cardHasPrintedScavenge(card: any): boolean {
  const kws = Array.isArray(card?.keywords) ? card.keywords.map((k: any) => String(k).toLowerCase()) : [];
  if (kws.includes('scavenge')) return true;
  return lowerOracle(card).split(/\n+/).some((line) => /^scavenge\b/.test(line.trim()));
}

/** Mana cost a granted scavenge uses for this graveyard card, or undefined when no grant applies. */
export function getGrantedScavengeCost(state: any, playerId: string, card: any): string | undefined {
  if (!card || !/\bcreature\b/i.test(String(card.type_line || ''))) return undefined;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const granted = battlefield.some((p: any) => p && String(p.controller) === String(playerId) && !p.card?.isFaceDownStub && oracleGrantsGraveyardScavenge(p.card?.oracle_text));
  if (!granted) return undefined;
  return String(card.mana_cost || card.manaCost || '').trim() || '{0}';
}
