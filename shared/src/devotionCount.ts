/**
 * CR 700.5: devotion is the number of mana symbols of the listed color(s)
 * among permanents you control. A two-color count (Iroas, Athreos, etc.)
 * counts each symbol at most once — `{R/W}` is one symbol, not two.
 */
const MANA_SYMBOL_RE = /\{([^}]+)\}/g;
const COLOR_LETTERS = new Set(['W', 'U', 'B', 'R', 'G']);

export function countDevotionSymbolsInManaCost(manaCost: string, colors: readonly string[]): number {
  const wanted = new Set(
    colors.map((color) => String(color || '').trim().toUpperCase()).filter((color) => COLOR_LETTERS.has(color)),
  );
  if (wanted.size === 0) return 0;

  let total = 0;
  const text = String(manaCost || '');
  MANA_SYMBOL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MANA_SYMBOL_RE.exec(text)) !== null) {
    const parts = match[1].toUpperCase().split('/');
    if (parts.some((part) => wanted.has(part))) total += 1;
  }
  return total;
}

const DEVOTION_INCREASE_RE =
  /your devotion to each color and each combination of colors is increased by (one|two|three|four|five|\d+)/i;
const DEVOTION_INCREASE_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

/** B61: Altar of the Pantheon ? flat bonus added to every devotion query. */
export function devotionIncreaseBonusAmongPermanents(
  permanents: readonly any[],
  playerId: string,
): number {
  const controller = String(playerId || '');
  if (!controller) return 0;
  let bonus = 0;
  for (const permanent of permanents) {
    if (!permanent || String(permanent.controller || '') !== controller) continue;
    if (permanent.phasedOut === true) continue;
    const oracle = String(permanent.card?.oracle_text || permanent.oracle_text || '');
    const m = oracle.match(DEVOTION_INCREASE_RE);
    if (!m) continue;
    const raw = String(m[1] || '').toLowerCase();
    bonus += /^\d+$/.test(raw) ? Math.max(0, Math.floor(Number(raw))) : (DEVOTION_INCREASE_WORDS[raw] || 0);
  }
  return bonus;
}

export function countDevotionAmongPermanents(
  permanents: readonly any[],
  playerId: string,
  colors: readonly string[],
): number {
  const controller = String(playerId || '');
  let total = 0;
  for (const permanent of permanents) {
    if (!permanent || String(permanent.controller || '') !== controller) continue;
    if (permanent.phasedOut === true) continue;
    const manaCost = String(
      permanent.card?.mana_cost || permanent.card?.manaCost || permanent.mana_cost || permanent.manaCost || '',
    );
    total += countDevotionSymbolsInManaCost(manaCost, colors);
  }
  // B61: Altar of the Pantheon ? devotion to each color/combo increased by N.
  total += devotionIncreaseBonusAmongPermanents(permanents, controller);
  return total;
}
