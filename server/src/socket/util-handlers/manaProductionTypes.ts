// server/src/socket/util-handlers/manaProductionTypes.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: ManaProductionInfo - the calculated mana-production result shape.
// Public entry symbols: ManaProductionInfo.
// Re-exported from util.ts so the "./util.js" import path keeps working.

/**
 * Mana production info for a permanent
 */
export interface ManaProductionInfo {
  /** Base colors this permanent can produce */
  colors: string[];
  /** Single color for creature-count mana (like any_combination for color choice) */
  color?: string;
  /** Base amount of mana produced per tap (before multipliers) */
  baseAmount: number;
  /** Whether the amount is dynamic (depends on game state) */
  isDynamic: boolean;
  /** Description of how mana is calculated (for dynamic sources) */
  dynamicDescription?: string;
  /** Extra mana from enchantments/effects on this permanent */
  bonusMana: { color: string; amount: number }[];
  /** Multiplier from global effects (Mana Reflection, Nyxbloom Ancient) */
  multiplier: number;
  /** Total mana produced (baseAmount * multiplier + bonuses) */
  totalAmount: number;
  /** Activation cost (for abilities like Three Tree City that require mana to activate) */
  activationCost?: string;
  /** Whether this ability requires a color choice prompt */
  requiresColorChoice?: boolean;
  /** Whether bonus mana (e.g. Fertile Ground) still needs an any-color choice */
  requiresBonusColorChoice?: boolean;
  /** Dynamic amount source when requiresColorChoice (e.g. devotion) */
  dynamicAmountSource?: string;
}
