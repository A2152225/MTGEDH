// server/src/state/utils-handlers/variablePowerGreatestManaValue.ts
// CDA "~'s power is equal to the greatest mana value among [other] <type>s you control" (CR 604.3)
// with printed toughness (Towering Gibbon */4, Dodgy Jalopy). Power-reading variants are not handled
// here because they would recurse into current P/T.
// Public entry symbols: calculateGreatestManaValuePowerCDA.

const RE = /\bpower is equal to the greatest mana value among (other )?(creatures|artifacts|permanents|enchantments) you control\b/;

function manaValueOf(card: any): number {
  const cmc = Number(card?.cmc ?? card?.mana_value);
  if (Number.isFinite(cmc)) return cmc;
  let total = 0;
  for (const sym of String(card?.mana_cost || '').match(/\{[^}]+\}/g) || []) {
    const s = sym.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(s)) total += parseInt(s, 10);
    else if (s !== 'X') total += 1;
  }
  return total;
}

export function calculateGreatestManaValuePowerCDA(
  card: any,
  oracleTextLower: string,
  battlefield: any[],
  controllerId: string,
): { power: number; toughness: number } | undefined {
  const m = RE.exec(oracleTextLower);
  if (!m || !String(card?.power ?? '').includes('*')) return undefined;
  const toughness = Number(card?.toughness);
  if (!Number.isFinite(toughness)) return undefined;
  const want = m[2] === 'permanents' ? '' : m[2].slice(0, -1);
  const selfId = String(card?.id || '');
  let best = 0;
  for (const perm of battlefield || []) {
    if (!perm || perm.phasedOut || String(perm.controller || '') !== controllerId) continue;
    if (m[1] && selfId && String(perm.card?.id || '') === selfId) continue;
    if (want && !String(perm.card?.type_line || '').toLowerCase().includes(want)) continue;
    best = Math.max(best, manaValueOf(perm.card));
  }
  return { power: best, toughness };
}
