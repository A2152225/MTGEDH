// server/src/state/modules/handCyclingGrants.ts
// Tectonic Reformation: "Each land card in your hand has cycling {R}."
// Battlefield grant of cycling to matching cards in hand.
// Public entry symbols: oracleGrantsHandCycling, cardHasPrintedCycling, getGrantedCyclingCost.

const GRANT_RE =
  /\beach (land|nonland|artifact|creature|enchantment)? ?cards? in your hand has cycling ((?:\{[^}]+\})+)/i;

export type HandCyclingGrant = {
  cardFilter: 'land' | 'nonland' | 'artifact' | 'creature' | 'enchantment' | 'any';
  cost: string;
};

export function oracleGrantsHandCycling(oracle: string): HandCyclingGrant | null {
  const m = String(oracle || '').replace(/\u2019/g, "'").match(GRANT_RE);
  if (!m) return null;
  const filterRaw = String(m[1] || '').toLowerCase();
  const cardFilter = (filterRaw || 'any') as HandCyclingGrant['cardFilter'];
  return { cardFilter, cost: String(m[2] || '').trim() };
}

export function cardHasPrintedCycling(card: any): boolean {
  const kws = Array.isArray(card?.keywords)
    ? card.keywords.map((k: any) => String(k).toLowerCase())
    : String(card?.keywords || '').toLowerCase().split(/[,;]/).map((k: string) => k.trim());
  if (kws.some((k: string) => k === 'cycling' || /cycling$/.test(k))) return true;
  return String(card?.oracle_text || card?.oracleText || '')
    .split(/\n+/)
    .some((line) => /^(?:[a-z ]+)?cycling\s*\{/i.test(line.trim()));
}

function cardMatchesFilter(card: any, filter: HandCyclingGrant['cardFilter']): boolean {
  const tl = String(card?.type_line || '').toLowerCase();
  if (filter === 'any') return true;
  if (filter === 'land') return /\bland\b/.test(tl);
  if (filter === 'nonland') return !/\bland\b/.test(tl);
  return new RegExp(`\\b${filter}\\b`).test(tl);
}

/** Cycling cost a battlefield grant gives `card` in `playerId`'s hand, or null when no grant applies. */
export function getGrantedCyclingCost(state: any, playerId: string, card: any): string | null {
  if (!card || cardHasPrintedCycling(card)) return null;
  let best: string | null = null;
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (String(perm?.controller || '') !== String(playerId) || perm?.phasedOut) continue;
    const grant = oracleGrantsHandCycling(String(perm?.card?.oracle_text || ''));
    if (!grant || !cardMatchesFilter(card, grant.cardFilter)) continue;
    if (best === null) best = grant.cost;
  }
  return best;
}
