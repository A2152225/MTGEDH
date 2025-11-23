/**
 * Defender - Rule 702.3
 * 
 * A creature with defender can't attack.
 */

/**
 * Represents the defender keyword ability
 * Rule 702.3
 */
export interface DefenderAbility {
  readonly type: 'defender';
  readonly source: string; // ID of the object with defender
}

/**
 * Create a defender ability
 * Rule 702.3a - Defender is a static ability
 * 
 * @param source - ID of the object with defender
 * @returns Defender ability
 */
export function defender(source: string): DefenderAbility {
  return {
    type: 'defender',
    source,
  };
}

/**
 * Check if a creature with defender can attack
 * Rule 702.3b - A creature with defender can't attack
 * 
 * @param hasDefender - Whether the creature has defender
 * @returns true if the creature can attack
 */
export function canAttackWithDefender(hasDefender: boolean): boolean {
  return !hasDefender;
}

/**
 * Check if multiple defender abilities are redundant
 * Rule 702.3c - Multiple instances of defender on the same creature are redundant
 * 
 * @param abilities - Array of defender abilities
 * @returns true if there are redundant instances
 */
export function hasRedundantDefender(abilities: readonly DefenderAbility[]): boolean {
  return abilities.length > 1;
}
