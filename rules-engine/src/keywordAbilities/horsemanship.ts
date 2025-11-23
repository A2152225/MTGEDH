/**
 * Horsemanship keyword ability implementation
 * Rule 702.31
 * 
 * Horsemanship is an evasion ability.
 */

/**
 * Horsemanship ability
 * Rule 702.31a
 * 
 * Creatures without horsemanship can't block creatures with horsemanship.
 */
export interface HorsemanshipAbility {
  readonly type: 'horsemanship';
  readonly source: string;
}

/**
 * Creates a horsemanship ability
 * Rule 702.31a
 * 
 * @param source - The creature with horsemanship
 * @returns Horsemanship ability
 */
export function horsemanship(source: string): HorsemanshipAbility {
  return {
    type: 'horsemanship',
    source,
  };
}

/**
 * Checks if a creature can block a creature with horsemanship
 * Rule 702.31a
 * 
 * @param blockerHasHorsemanship - Whether the blocker has horsemanship
 * @returns True if the blocker can block horsemanship
 */
export function canBlockHorsemanship(blockerHasHorsemanship: boolean): boolean {
  return blockerHasHorsemanship;
}

/**
 * Checks if multiple horsemanship abilities are redundant
 * Rule 702.31b - Multiple instances of horsemanship are redundant
 * 
 * @param abilities - Array of horsemanship abilities
 * @returns True if more than one horsemanship
 */
export function hasRedundantHorsemanship(abilities: readonly HorsemanshipAbility[]): boolean {
  return abilities.length > 1;
}
