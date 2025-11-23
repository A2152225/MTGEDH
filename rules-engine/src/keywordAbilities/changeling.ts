/**
 * Changeling keyword ability (Rule 702.73)
 * 
 * @module keywordAbilities/changeling
 */

/**
 * Represents a changeling ability on a permanent or card.
 * Rule 702.73: Changeling is a characteristic-defining ability. "Changeling" means 
 * "This object is every creature type." This ability works everywhere, even outside 
 * the game.
 */
export interface ChangelingAbility {
  readonly type: 'changeling';
  readonly source: string;
}

/**
 * Creates a changeling ability.
 * 
 * @param source - The source object with changeling
 * @returns A changeling ability
 * 
 * @example
 * ```typescript
 * const ability = changeling('Chameleon Colossus');
 * ```
 */
export function changeling(source: string): ChangelingAbility {
  return {
    type: 'changeling',
    source
  };
}

/**
 * Checks if an object has a specific creature type due to changeling.
 * 
 * @param ability - The changeling ability
 * @param creatureType - Any creature type
 * @returns Always true (has all creature types)
 */
export function hasCreatureType(ability: ChangelingAbility, creatureType: string): boolean {
  return true; // Changeling has every creature type
}
