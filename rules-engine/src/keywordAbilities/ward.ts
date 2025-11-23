/**
 * Ward keyword ability implementation
 * Rule 702.21
 * 
 * Ward is a triggered ability that triggers whenever a permanent with ward
 * becomes the target of a spell or ability an opponent controls.
 */

/**
 * Ward ability
 * Rule 702.21a
 * 
 * Represents ward on a permanent. Ward causes opponents to pay an
 * additional cost when targeting this permanent.
 */
export interface WardAbility {
  readonly type: 'ward';
  readonly cost: string; // Mana cost or other cost (e.g., "{2}", "Sacrifice a creature")
  readonly source: string; // The object with ward
}

/**
 * Creates a ward ability
 * Rule 702.21a
 * 
 * @param source - The permanent with ward
 * @param cost - The cost opponents must pay to target this permanent
 * @returns Ward ability
 */
export function ward(source: string, cost: string): WardAbility {
  return {
    type: 'ward',
    cost,
    source,
  };
}

/**
 * Checks if ward cost was paid
 * Rule 702.21b
 * 
 * @param ability - The ward ability
 * @param paidCost - The cost that was paid
 * @returns True if the ward cost was paid
 */
export function isWardCostPaid(ability: WardAbility, paidCost: string): boolean {
  return ability.cost === paidCost;
}

/**
 * Checks if multiple ward abilities are redundant
 * Rule 702.21c - Multiple instances of ward with the same cost are redundant
 * 
 * @param abilities - Array of ward abilities on the same object
 * @returns True if any abilities have the same cost
 */
export function hasRedundantWard(abilities: readonly WardAbility[]): boolean {
  const costs = abilities.map(a => a.cost);
  return costs.length !== new Set(costs).size;
}
