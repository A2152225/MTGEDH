/**
 * Rampage keyword ability implementation
 * Rule 702.23
 * 
 * Rampage is a triggered ability that triggers when a creature becomes blocked.
 */

/**
 * Rampage ability
 * Rule 702.23a
 * 
 * Whenever a creature with rampage becomes blocked, it gets +X/+X for each
 * creature blocking it beyond the first.
 */
export interface RampageAbility {
  readonly type: 'rampage';
  readonly bonus: number; // The X value (e.g., rampage 2 means +2/+2 per blocker)
  readonly source: string;
}

/**
 * Creates a rampage ability
 * Rule 702.23a
 * 
 * @param source - The creature with rampage
 * @param bonus - The bonus per blocker beyond the first
 * @returns Rampage ability
 */
export function rampage(source: string, bonus: number): RampageAbility {
  return {
    type: 'rampage',
    bonus,
    source,
  };
}

/**
 * Calculates rampage bonus
 * Rule 702.23b
 * 
 * @param ability - The rampage ability
 * @param blockerCount - Number of creatures blocking
 * @returns Total power/toughness bonus
 */
export function calculateRampageBonus(ability: RampageAbility, blockerCount: number): number {
  if (blockerCount <= 1) return 0;
  return ability.bonus * (blockerCount - 1);
}

/**
 * Checks if multiple rampage abilities stack
 * Rule 702.23c - Multiple instances of rampage are cumulative
 * 
 * @param abilities - Array of rampage abilities
 * @param blockerCount - Number of blockers
 * @returns Total combined bonus
 */
export function combinedRampageBonus(
  abilities: readonly RampageAbility[],
  blockerCount: number
): number {
  return abilities.reduce((total, ability) => {
    return total + calculateRampageBonus(ability, blockerCount);
  }, 0);
}
