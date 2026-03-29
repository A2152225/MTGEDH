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

/**
 * Gets a representative list of creature types supported by changeling tests.
 * Changeling conceptually grants every creature type; this helper provides a stable list
 * for callers that need an explicit set in fixtures.
 *
 * @returns A representative creature-type list
 */
export function getRepresentativeChangelingTypes(): readonly string[] {
  return ['Advisor', 'Elf', 'Goblin', 'Human', 'Shapeshifter', 'Zombie'];
}

/**
 * Checks whether changeling grants the requested creature type.
 *
 * @param ability - The changeling ability
 * @param creatureType - The creature type being queried
 * @returns True for any non-empty creature type
 */
export function hasChangelingType(
  ability: ChangelingAbility,
  creatureType: string
): boolean {
  return creatureType.trim().length > 0 && hasCreatureType(ability, creatureType);
}

/**
 * Creates a summary of changeling's type-granting effect.
 *
 * @param ability - The changeling ability
 * @param queriedTypes - Creature types to check
 * @returns Summary of whether changeling grants all queried types
 */
export function createChangelingTypeResult(
  ability: ChangelingAbility,
  queriedTypes: readonly string[]
): {
  source: string;
  queriedTypes: readonly string[];
  allTypesMatch: boolean;
} {
  return {
    source: ability.source,
    queriedTypes,
    allTypesMatch: queriedTypes.every(type => hasChangelingType(ability, type)),
  };
}
