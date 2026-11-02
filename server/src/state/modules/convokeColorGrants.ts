// server/src/state/modules/convokeColorGrants.ts
// Batch 37: "<Color> spells you cast have convoke." (and multicolored / colorless).
// Origin parent: casting-modifiers.ts (getStaticConvokeGrantScopesFromBattlefield), which otherwise read these as all spells.
// Public entry symbols: colorConvokeGrantMatch.

const COLOR_CONVOKE_RE = /\b(white|blue|black|red|green|multicolored|colorless) spells you cast have convoke/i;
const LETTER: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

function cardColors(card: any): string[] {
  if (Array.isArray(card?.colors)) return card.colors.map((c: any) => String(c).toUpperCase());
  const cost = String(card?.mana_cost || card?.manaCost || '').toUpperCase();
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => cost.includes(c));
}

/** null when the text has no color convoke grant; otherwise whether the spell gets convoke. */
export function colorConvokeGrantMatch(oracleText: string, card: any): boolean | null {
  const m = String(oracleText || '').match(COLOR_CONVOKE_RE);
  if (!m) return null;
  const word = m[1].toLowerCase();
  const colors = cardColors(card);
  if (word === 'multicolored') return colors.length > 1;
  if (word === 'colorless') return colors.length === 0;
  return colors.includes(LETTER[word]);
}
