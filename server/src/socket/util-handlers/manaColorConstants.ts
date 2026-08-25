// server/src/socket/util-handlers/manaColorConstants.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: mana color symbol/key constants and the symbol -> name helper.
// Public entry symbols: MANA_COLOR_NAMES, MANA_COLORS, ManaColorSymbol,
//   MANA_COLOR_KEYS, ManaColorKey, getManaColorName.
// Re-exported from util.ts so the "./util.js" import path keeps working.

/**
 * Maps mana color symbols to their human-readable names.
 */
export const MANA_COLOR_NAMES: Record<string, string> = {
  'W': 'white',
  'U': 'blue',
  'B': 'black',
  'R': 'red',
  'G': 'green',
  'C': 'colorless',
};

/**
 * Standard mana color symbols in WUBRG order plus colorless.
 */
export const MANA_COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
export type ManaColorSymbol = typeof MANA_COLORS[number];

/**
 * Mana color keys used in ManaPool interface
 * Extracted as constant to ensure consistency across mana pool operations
 */
export const MANA_COLOR_KEYS = ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const;
export type ManaColorKey = typeof MANA_COLOR_KEYS[number];

/**
 * Gets the human-readable name for a mana color symbol.
 */
export function getManaColorName(symbol: string): string {
  return MANA_COLOR_NAMES[symbol] || symbol.toLowerCase();
}
