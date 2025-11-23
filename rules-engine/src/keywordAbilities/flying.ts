/**
 * Flying - Rule 702.9
 * 
 * A creature with flying can't be blocked except by creatures with flying and/or reach.
 */

/**
 * Represents the flying keyword ability
 * Rule 702.9
 */
export interface FlyingAbility {
  readonly type: 'flying';
  readonly source: string; // ID of the object with flying
}

/**
 * Create a flying ability
 * Rule 702.9a - Flying is an evasion ability
 * 
 * @param source - ID of the object with flying
 * @returns Flying ability
 */
export function flying(source: string): FlyingAbility {
  return {
    type: 'flying',
    source,
  };
}

/**
 * Check if a creature can block a creature with flying
 * Rule 702.9b - A creature with flying can't be blocked except by creatures with flying and/or reach
 * 
 * @param blockerHasFlying - Whether the blocking creature has flying
 * @param blockerHasReach - Whether the blocking creature has reach
 * @param attackerHasFlying - Whether the attacking creature has flying
 * @returns true if the blocker can block the attacker
 */
export function canBlockFlying(
  blockerHasFlying: boolean,
  blockerHasReach: boolean,
  attackerHasFlying: boolean
): boolean {
  if (!attackerHasFlying) {
    return true; // Can always block non-flying creatures
  }
  return blockerHasFlying || blockerHasReach;
}

/**
 * Check if a creature with flying can block another creature
 * Rule 702.9b - A creature with flying can block a creature with or without flying
 * 
 * @param hasFlying - Whether the blocking creature has flying
 * @returns true (creatures with flying can block any creature)
 */
export function flyingCanBlock(hasFlying: boolean): boolean {
  return true; // Flying doesn't restrict what you can block
}

/**
 * Check if multiple flying abilities are redundant
 * Rule 702.9c - Multiple instances of flying on the same creature are redundant
 * 
 * @param abilities - Array of flying abilities
 * @returns true if there are redundant instances
 */
export function hasRedundantFlying(abilities: readonly FlyingAbility[]): boolean {
  return abilities.length > 1;
}
