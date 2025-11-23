/**
 * Vigilance - Rule 702.20
 * 
 * Attacking doesn't cause this creature to tap.
 */

/**
 * Represents the vigilance keyword ability
 * Rule 702.20
 */
export interface VigilanceAbility {
  readonly type: 'vigilance';
  readonly source: string; // ID of the object with vigilance
}

/**
 * Create a vigilance ability
 * Rule 702.20a - Vigilance is a static ability that modifies the rules for the declare attackers step
 * 
 * @param source - ID of the object with vigilance
 * @returns Vigilance ability
 */
export function vigilance(source: string): VigilanceAbility {
  return {
    type: 'vigilance',
    source,
  };
}

/**
 * Check if a creature becomes tapped when attacking
 * Rule 702.20b - Attacking doesn't cause creatures with vigilance to tap
 * 
 * @param hasVigilance - Whether the creature has vigilance
 * @returns true if the creature becomes tapped when attacking
 */
export function tapsWhenAttacking(hasVigilance: boolean): boolean {
  return !hasVigilance;
}

/**
 * Check if multiple vigilance abilities are redundant
 * Rule 702.20c - Multiple instances of vigilance on the same creature are redundant
 * 
 * @param abilities - Array of vigilance abilities
 * @returns true if there are redundant instances
 */
export function hasRedundantVigilance(abilities: readonly VigilanceAbility[]): boolean {
  return abilities.length > 1;
}
