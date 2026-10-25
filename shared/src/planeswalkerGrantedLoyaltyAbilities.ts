// shared/src/planeswalkerGrantedLoyaltyAbilities.ts
// Quoted loyalty-ability grants: "Planeswalkers you control have \"[-4]: ...\""
// (Way of the Warlord, Sanctum Lurker, the Way of the ... cycle). Granted
// lines are appended after the printed loyalty lines, so pw-ability-N indices
// for printed abilities stay stable and client/server enumerate in one order.
// Public entry symbols: extractPlaneswalkerLoyaltyGrants,
//   collectGrantedLoyaltyAbilityLines, appendGrantedLoyaltyAbilityLines.

type PermLike = {
  id?: string;
  controller?: string;
  card?: { oracle_text?: string; type_line?: string } | null;
};

const GRANT_RE = /\bplaneswalkers you control have ((?:"[^"]+"(?:,? (?:and )?)?)+)/gi;

function normalizeQuotes(text: string): string {
  return String(text || '').replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
}

/** "[\u22124]: Draw a card." -> "-4: Draw a card." */
export function extractPlaneswalkerLoyaltyGrants(oracleText: string): string[] {
  const out: string[] = [];
  const text = normalizeQuotes(oracleText);
  for (const grant of text.matchAll(GRANT_RE)) {
    for (const quoted of String(grant[1] || '').matchAll(/"([^"]+)"/g)) {
      const m = String(quoted[1] || '').trim().match(/^\[?([+\-\u2212\u2013\u2014]?(?:\d+|X))\]?\s*:\s*(.+)$/i);
      if (!m) continue;
      const cost = m[1].replace(/[\u2212\u2013\u2014]/g, '-');
      out.push(`${cost}: ${m[2].trim()}`);
    }
  }
  return out;
}

function isPlaneswalker(perm: PermLike | null | undefined): boolean {
  return /\bplaneswalker\b/i.test(String(perm?.card?.type_line || ''));
}

export function collectGrantedLoyaltyAbilityLines(
  battlefield: readonly PermLike[] | null | undefined,
  planeswalker: PermLike | null | undefined,
): string[] {
  if (!planeswalker || !isPlaneswalker(planeswalker)) return [];
  const controller = String(planeswalker.controller || '');
  if (!controller) return [];
  const lines: string[] = [];
  for (const perm of Array.isArray(battlefield) ? battlefield : []) {
    if (!perm || String(perm.controller || '') !== controller) continue;
    for (const line of extractPlaneswalkerLoyaltyGrants(String(perm.card?.oracle_text || ''))) {
      if (!lines.includes(line)) lines.push(line);
    }
  }
  return lines;
}

/** Printed oracle text plus one "cost: text" line per granted loyalty ability. */
export function appendGrantedLoyaltyAbilityLines(
  oracleText: string,
  battlefield: readonly PermLike[] | null | undefined,
  planeswalker: PermLike | null | undefined,
): string {
  const granted = collectGrantedLoyaltyAbilityLines(battlefield, planeswalker);
  if (granted.length === 0) return String(oracleText || '');
  return [String(oracleText || ''), ...granted].join('\n');
}
