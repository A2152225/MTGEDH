/**
 * Devoid keyword ability (Rule 702.114)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.114. Devoid
 * 702.114a Devoid is a characteristic-defining ability. "Devoid" means "This object is 
 * colorless." This ability functions everywhere, even outside the game. See rule 604.3.
 */

export interface DevoidAbility {
  readonly type: 'devoid';
  readonly source: string;
}

/**
 * Create a devoid ability
 * Rule 702.114a - Makes object colorless
 * @param source - The object with devoid
 * @returns Devoid ability object
 */
export function devoid(source: string): DevoidAbility {
  return {
    type: 'devoid',
    source,
  };
}

/**
 * Check if an object is colorless due to devoid
 * Rule 702.114a - Devoid makes object colorless everywhere
 * @param hasDevoid - Whether object has devoid
 * @returns True (always colorless if has devoid)
 */
export function isColorless(hasDevoid: boolean): boolean {
  return hasDevoid;
}

/**
 * Multiple instances of devoid are redundant
 * @param abilities - Array of devoid abilities
 * @returns True if more than one instance
 */
export function hasRedundantDevoid(abilities: readonly DevoidAbility[]): boolean {
  return abilities.length > 1;
}
