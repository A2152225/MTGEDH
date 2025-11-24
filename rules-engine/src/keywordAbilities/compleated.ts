/**
 * Compleated keyword ability (Rule 702.150)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.150. Compleated
 * 702.150a Compleated is a static ability found on some planeswalker cards. Compleated means 
 * "If this permanent would enter with one or more loyalty counters on it and the player who cast 
 * it chose to pay life for any part of its cost represented by Phyrexian mana symbols, it 
 * instead enters the battlefield with that many loyalty counters minus two for each of those 
 * mana symbols."
 */

export interface CompleatedAbility {
  readonly type: 'compleated';
  readonly source: string;
  readonly phyrexianManaPaid: number; // Number of Phyrexian mana symbols paid with life
  readonly loyaltyReduction: number;
}

/**
 * Create a compleated ability
 * Rule 702.150a
 * @param source - The planeswalker with compleated
 * @returns Compleated ability object
 */
export function compleated(source: string): CompleatedAbility {
  return {
    type: 'compleated',
    source,
    phyrexianManaPaid: 0,
    loyaltyReduction: 0,
  };
}

/**
 * Apply compleated when casting with Phyrexian mana paid as life
 * Rule 702.150a - Minus two loyalty for each Phyrexian mana paid with life
 * @param ability - Compleated ability
 * @param phyrexianManaPaidWithLife - Number of Phyrexian symbols paid with life
 * @returns Updated ability
 */
export function applyCompleated(
  ability: CompleatedAbility,
  phyrexianManaPaidWithLife: number
): CompleatedAbility {
  return {
    ...ability,
    phyrexianManaPaid: phyrexianManaPaidWithLife,
    loyaltyReduction: phyrexianManaPaidWithLife * 2,
  };
}

/**
 * Calculate starting loyalty with compleated
 * Rule 702.150a
 * @param baseLoyalty - Base loyalty counters
 * @param loyaltyReduction - Reduction from compleated
 * @returns Actual starting loyalty
 */
export function calculateStartingLoyalty(baseLoyalty: number, loyaltyReduction: number): number {
  return Math.max(0, baseLoyalty - loyaltyReduction);
}

/**
 * Get loyalty reduction
 * @param ability - Compleated ability
 * @returns Loyalty reduction amount
 */
export function getLoyaltyReduction(ability: CompleatedAbility): number {
  return ability.loyaltyReduction;
}

/**
 * Multiple instances of compleated are redundant
 * @param abilities - Array of compleated abilities
 * @returns True if more than one
 */
export function hasRedundantCompleated(abilities: readonly CompleatedAbility[]): boolean {
  return abilities.length > 1;
}
