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
  return total;
}
