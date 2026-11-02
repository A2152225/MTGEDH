// server/src/state/modules/foretellGrants.ts
// Static foretell grants to cards in hand (CR 702.143): "Each nonland card in your hand without foretell has foretell.
// Its foretell cost is equal to its mana cost reduced by {2}." (Dream Devourer, Bohn, Beguiling Balladeer).
// Public entry symbols: oracleGrantsHandForetell, getGrantedForetellCost, reduceGenericManaCost, cardHasPrintedForetell.

const GRANT_RE = /each (nonland )?card in your hand without foretell has foretell\.\s*its foretell cost is equal to its mana cost reduced by \{(\d+)\}/i;

export function oracleGrantsHandForetell(oracle: string): { nonlandOnly: boolean; reduction: number } | null {
  const m = String(oracle || '').replace(/\u2019/g, "'").match(GRANT_RE);
  return m ? { nonlandOnly: !!m[1], reduction: Number(m[2]) || 0 } : null;
}

export function cardHasPrintedForetell(card: any): boolean {
  const kw = card?.keywords;
  if (Array.isArray(kw) ? kw.some((k: unknown) => String(k || '').toLowerCase() === 'foretell') : /\bforetell\b/i.test(String(kw || ''))) return true;
  // Lines that only mention foretell inside a grant ("without foretell has foretell") are not the keyword.
  return String(card?.oracle_text || card?.oracleText || '').split(/\n+/).some((line) => /^foretell\b/i.test(line.trim()));
}

/** "{3}{U}{U}" reduced by 2 -> "{1}{U}{U}"; only generic mana is reduced (CR 118.7). */
export function reduceGenericManaCost(cost: string, reduction: number): string {
  const symbols = String(cost || '').match(/\{[^}]+\}/g) || [];
  let left = Math.max(0, reduction);
  const out: string[] = [];
  for (const sym of symbols) {
    const g = sym.match(/^\{(\d+)\}$/);
    if (g) { const n = Number(g[1]); const take = Math.min(n, left); left -= take; if (n - take > 0) out.push(`{${n - take}}`); continue; }
    out.push(sym);
  }
  return out.length ? out.join('') : '{0}';
}

/** Foretell cost a battlefield grant gives `card` in `playerId`'s hand, or null when no grant applies. */
export function getGrantedForetellCost(state: any, playerId: string, card: any): string | null {
  if (!card || cardHasPrintedForetell(card)) return null;
  const isLand = /\bland\b/i.test(String(card.type_line || ''));
  const mana = String(card.mana_cost || card.manaCost || '');
  let best: string | null = null;
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (String(perm?.controller || '') !== String(playerId) || perm?.phasedOut) continue;
    const grant = oracleGrantsHandForetell(String(perm?.card?.oracle_text || ''));
    if (!grant || (grant.nonlandOnly && isLand)) continue;
    const cost = reduceGenericManaCost(mana, grant.reduction);
    if (best === null) best = cost;
  }
  return best;
}
