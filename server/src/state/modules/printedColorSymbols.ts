/** Printed mana-color symbols from card fields, used when `colors` is missing. */

const COLOR_NAME_TO_SYMBOL: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
  w: 'W',
  u: 'U',
  b: 'B',
  r: 'R',
  g: 'G',
};

export function colorNameToManaSymbol(colorName: string): string | null {
  const key = String(colorName || '').trim().toLowerCase();
  if (!key) return null;
  if (COLOR_NAME_TO_SYMBOL[key]) return COLOR_NAME_TO_SYMBOL[key];
  const upper = key.toUpperCase();
  return ['W', 'U', 'B', 'R', 'G'].includes(upper) ? upper : null;
}

function pushUniqueSymbol(symbols: string[], raw: unknown): void {
  const symbol = colorNameToManaSymbol(String(raw || ''));
  if (symbol && !symbols.includes(symbol)) symbols.push(symbol);
}

export function collectPrintedColorSymbols(cardLike: unknown): string[] {
  if (!cardLike || typeof cardLike !== 'object') return [];
  const card = cardLike as Record<string, unknown>;
  const nested = card.card && typeof card.card === 'object' ? (card.card as Record<string, unknown>) : undefined;
  const sources = [card, nested].filter(Boolean) as Record<string, unknown>[];
  const symbols: string[] = [];

  for (const source of sources) {
    const colors = source.colors;
    if (Array.isArray(colors)) {
      for (const entry of colors) pushUniqueSymbol(symbols, entry);
    }
  }
  if (symbols.length > 0) return symbols;

  for (const source of sources) {
    const identity = source.color_identity;
    if (Array.isArray(identity)) {
      for (const entry of identity) pushUniqueSymbol(symbols, entry);
    }
  }
  if (symbols.length > 0) return symbols;

  for (const source of sources) {
    const manaCost = String(source.mana_cost || source.manaCost || '');
    for (const match of manaCost.matchAll(/[WUBRG]/gi)) {
      pushUniqueSymbol(symbols, match[0]);
    }
  }

  return symbols;
}

export function printedObjectHasManaColor(cardLike: unknown, colorName: string): boolean {
  const symbol = colorNameToManaSymbol(colorName);
  if (!symbol) return false;
  if (collectPrintedColorSymbols(cardLike).includes(symbol)) return true;
  const typeLine = String(
    (cardLike as any)?.type_line
    || (cardLike as any)?.card?.type_line
    || '',
  ).toLowerCase();
  return typeLine.includes(String(colorName || '').trim().toLowerCase());
}
