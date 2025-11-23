/**
 * Reach - Rule 702.17
 * 
 * A creature with reach can block creatures with flying.
 */

/**
 * Represents the reach keyword ability
 * Rule 702.17
 */
export interface ReachAbility {
  readonly type: 'reach';
  readonly source: string; // ID of the object with reach
}

/**
 * Create a reach ability
 * Rule 702.17a - Reach is a static ability
 * 
 * @param source - ID of the object with reach
 * @returns Reach ability
 */
export function reach(source: string): ReachAbility {
  return {
    type: 'reach',
    source,
  };
}

/**
 * Check if a creature with reach can block a flying creature
 * Rule 702.17b - A creature with flying can't be blocked except by creatures with flying and/or reach
 * 
 * @param hasReach - Whether the blocking creature has reach
 * @param attackerHasFlying - Whether the attacking creature has flying
 * @returns true if can block
 */
export function canBlockFlyingWithReach(hasReach: boolean, attackerHasFlying: boolean): boolean {
  if (!attackerHasFlying) {
    return true; // Can always block non-flying creatures
  }
  return hasReach;
}

/**
 * Check if multiple reach abilities are redundant
 * Rule 702.17c - Multiple instances of reach on the same creature are redundant
 * 
 * @param abilities - Array of reach abilities
 * @returns true if there are redundant instances
 */
export function hasRedundantReach(abilities: readonly ReachAbility[]): boolean {
  return abilities.length > 1;
}
