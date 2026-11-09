// server/src/rules-engine/wallOnlyTargetRestriction.ts
// Wall of Shadows: "This creature can't be the target of spells that can target only Walls
// or of abilities that can target only Walls."
// Public entry symbols: permanentRejectsWallOnlyTargets, sourceCanTargetOnlyWalls.

export function permanentRejectsWallOnlyTargets(permanent: any): boolean {
  const card = permanent?.card;
  if (!card || card.isFaceDownStub === true) return false;
  const text = String(card.oracle_text || '').toLowerCase().replace(/\u2019/g, "'").replace(/\([^)]*\)/g, '');
  return /can(?:not|'t) be the target of spells that can target only walls(?: or of abilities that can target only walls)?/.test(text);
}

/**
 * True when the source's targeting language is restricted to Walls alone
 * (e.g. "target Wall", "target Wall creature") without a broader creature/permanent target.
 */
export function sourceCanTargetOnlyWalls(source: any): boolean {
  const card = source?.card || source;
  if (!card) return false;
  const text = String(card.oracle_text || card.oracleText || '')
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/\([^)]*\)/g, ' ');
  if (!/\btarget walls?\b/.test(text)) return false;
  // Broader creature / permanent targeting means it is not "only Walls".
  if (/\btarget (?:creature|permanent|artifact|enchantment|planeswalker)\b/.test(text.replace(/\btarget wall(?: creature)?\b/g, ' '))) {
    return false;
  }
  return true;
}
