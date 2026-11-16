// rules-engine/src/batch105KeywordLoss.ts
// "Creatures lose all abilities." (Dress Down family)

const RE = /(?:^|\n)\s*creatures lose all abilities\.?\s*(?:\n|$)/i;

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '');
}

export function batch105CreaturesLoseAllAbilitiesFromBattlefield(
  perm: any,
  battlefield?: readonly any[],
): boolean {
  if (!perm || !Array.isArray(battlefield)) return false;
  const tl = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
  if (!/\bcreature\b/.test(tl)) return false;
  return battlefield.some((src) => src && src.phasedOut !== true && RE.test(oracleOf(src)));
}
