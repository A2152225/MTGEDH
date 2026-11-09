// server/src/state/modules/graveyardEncoreGrants.ts
// Sliver Gravemother: "Each Sliver creature card in your graveyard has encore {X}, where X is its mana value."
// Battlefield grant of encore to matching graveyard creature cards. Cost is {N} with N = mana value.
// Public entry symbols: oracleGrantsGraveyardEncore, cardHasPrintedEncore, getGrantedEncoreCost.

const GRANT_RE =
  /\beach (?:([a-z][a-z'-]*) )?creature card in your graveyard has encore \{x\}, where x is its mana value\b/i;

function lowerOracle(card: any): string {
  return String(card?.oracle_text || '').toLowerCase().replace(/\u2019/g, "'");
}

export type GraveyardEncoreGrant = {
  creatureType?: string;
};

export function oracleGrantsGraveyardEncore(oracle: string): GraveyardEncoreGrant | null {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(GRANT_RE);
  if (!m) return null;
  const creatureType = m[1] ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : undefined;
  return { creatureType };
}

export function cardHasPrintedEncore(card: any): boolean {
  const kws = Array.isArray(card?.keywords) ? card.keywords.map((k: any) => String(k).toLowerCase()) : [];
  if (kws.includes('encore')) return true;
  return lowerOracle(card).split(/\n+/).some((line) => /^encore\b/.test(line.trim()));
}

function cardManaValue(card: any): number {
  const raw = card?.cmc ?? card?.mana_value ?? card?.manaValue;
  if (Number.isFinite(Number(raw))) return Math.max(0, Math.floor(Number(raw)));
  const symbols = String(card?.mana_cost || card?.manaCost || '').match(/\{[^}]+\}/g) || [];
  let total = 0;
  for (const sym of symbols) {
    const g = sym.match(/^\{(\d+)\}$/);
    if (g) { total += Number(g[1]); continue; }
    if (/^\{[WUBRGC]\}$/i.test(sym)) total += 1;
    else if (/^\{[WUBRG]\/[WUBRG]\}$/i.test(sym)) total += 1;
    else if (/^\{[WUBRG]\/P\}$/i.test(sym)) total += 1;
    else if (/^\{2\/[WUBRG]\}$/i.test(sym)) total += 2;
  }
  return total;
}

function typeLineHasCreatureType(typeLine: string, creatureType: string): boolean {
  const wanted = String(creatureType || '').toLowerCase();
  if (!wanted) return true;
  return new RegExp(`\\b${wanted.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(typeLine);
}

/** Encore cost a battlefield grant gives this graveyard card, or undefined when no grant applies. */
export function getGrantedEncoreCost(state: any, playerId: string, card: any): string | undefined {
  if (!card || !/\bcreature\b/i.test(String(card.type_line || ''))) return undefined;
  if (cardHasPrintedEncore(card)) return undefined;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const p of battlefield) {
    if (!p || String(p.controller) !== String(playerId) || p.card?.isFaceDownStub || p.phasedOut) continue;
    const grant = oracleGrantsGraveyardEncore(p.card?.oracle_text);
    if (!grant) continue;
    if (grant.creatureType && !typeLineHasCreatureType(String(card.type_line || ''), grant.creatureType)) continue;
    const mv = cardManaValue(card);
    return `{${mv}}`;
  }
  return undefined;
}
