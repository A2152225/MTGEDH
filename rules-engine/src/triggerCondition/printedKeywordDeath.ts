/**
 * Printed undying/persist detection. Split from parseFamilies.ts with no behavior change;
 * parseFamilies.ts re-exports printedKeywordDeathAbilities.
 */

const KEYWORD_DEATH = /\b(undying|persist)\b/gi;

/** Printed undying/persist, ignoring reminder text. */
export function printedKeywordDeathAbilities(oracleText: string): Array<'undying' | 'persist'> {
  const text = String(oracleText || '').replace(/\([^)]*\)/g, ' ');
  const found = new Set<'undying' | 'persist'>();
  for (const match of text.matchAll(KEYWORD_DEATH)) {
    const word = String(match[1] || '').toLowerCase();
    if (word === 'undying' || word === 'persist') found.add(word);
  }
  return [...found];
}
