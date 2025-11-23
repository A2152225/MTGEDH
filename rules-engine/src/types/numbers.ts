/**
 * Rule 107: Numbers and Symbols
 * Rules for how the game uses numbers
 */

// Rule 107.1 - The only numbers the Magic game uses are integers
export type GameNumber = number; // TypeScript number, but conceptually integer only

/**
 * Rule 107.1a - Can't choose fractional numbers, deal fractional damage, etc.
 * Rule 107.1b - Usually only positive numbers and zero
 */
export function isValidGameNumber(value: number): boolean {
  return Number.isInteger(value);
}

/**
 * Rule 107.1b - Calculations that yield negative values use zero instead
 * (except for life totals and power/toughness which can be negative)
 */
export function normalizeToZero(value: number): number {
  return Math.max(0, Math.floor(value));
}

/**
 * Rule 107.1c - "Any number" means any positive number or zero
 */
export type AnyNumber = number; // Must be >= 0

/**
 * Rule 107.2 - If a number can't be determined, use 0
 */
export const UNDEFINED_NUMBER = 0;

/**
 * Rule 107.3 - X is a placeholder for a number
 */
export type XValue = number | 'undefined';

/**
 * Rule 107.4 - Mana symbols (represented as strings)
 */
export type ManaSymbol = 
  | '{W}'   // White
  | '{U}'   // Blue  
  | '{B}'   // Black
  | '{R}'   // Red
  | '{G}'   // Green
  | '{C}'   // Colorless
  | `{${number}}`  // Generic mana (e.g., {1}, {2}, {3})
  | '{X}'   // Variable
  | '{S}'   // Snow
  | '{W/U}' | '{W/B}' | '{U/B}' | '{U/R}' | '{B/R}' | '{B/G}' | '{R/G}' | '{R/W}' | '{G/W}' | '{G/U}' // Hybrid
  | '{2/W}' | '{2/U}' | '{2/B}' | '{2/R}' | '{2/G}' // Generic/Color hybrid
  | '{W/P}' | '{U/P}' | '{B/P}' | '{R/P}' | '{G/P}'; // Phyrexian

/**
 * Rule 107.5 - Tap and untap symbols
 */
export type TapSymbol = '{T}';
export type UntapSymbol = '{Q}';

/**
 * Parse a mana cost string into symbols
 */
export function parseManaSymbols(manaCost: string): ManaSymbol[] {
  const symbolRegex = /\{[^}]+\}/g;
  const matches = manaCost.match(symbolRegex);
  return (matches || []) as ManaSymbol[];
}

/**
 * Calculate converted mana cost / mana value
 */
export function calculateManaValue(symbols: ManaSymbol[], xValue: number = 0): number {
  let total = 0;
  
  for (const symbol of symbols) {
    if (symbol === '{X}') {
      total += xValue;
    } else if (symbol.match(/^\{\d+\}$/)) {
      // Generic mana like {3}
      const amount = parseInt(symbol.slice(1, -1), 10);
      total += amount;
    } else if (symbol === '{W}' || symbol === '{U}' || symbol === '{B}' || 
               symbol === '{R}' || symbol === '{G}' || symbol === '{C}') {
      total += 1;
    } else if (symbol.includes('/')) {
      // Hybrid costs count as 1
      total += 1;
    }
    // Add more symbol types as needed
  }
  
  return total;
}
