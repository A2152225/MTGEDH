/**
 * Firebending keyword ability (Rule 702.189)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.189. Firebending
 * 702.189a Firebending is a triggered ability. "Firebending N" means "Whenever this creature 
 * attacks, add N {R}. Until end of combat, you don't lose this mana as steps and phases end."
 * 702.189b An ability that triggers whenever a player firebends triggers whenever a firebending 
 * ability they control resolves.
 */

export interface FirebendingAbility {
  readonly type: 'firebending';
  readonly source: string;
  readonly firebendingValue: number; // Amount of {R} to add
  readonly manaAdded: number;
}

/**
 * Create a firebending ability
 * Rule 702.189a
 * @param source - The creature with firebending
 * @param firebendingValue - Amount of {R} to add
 * @returns Firebending ability object
 */
export function firebending(source: string, firebendingValue: number): FirebendingAbility {
  return {
    type: 'firebending',
    source,
    firebendingValue,
    manaAdded: 0,
  };
}

/**
 * Trigger firebending when attacking
 * Rule 702.189a - Add {R}, doesn't empty until end of combat
 * @param ability - Firebending ability
 * @returns Updated ability
 */
export function triggerFirebending(ability: FirebendingAbility): FirebendingAbility {
  return {
    ...ability,
    manaAdded: ability.firebendingValue,
  };
}

/**
 * Get mana added
 * @param ability - Firebending ability
 * @returns Amount of {R} added
 */
export function getFirebendingMana(ability: FirebendingAbility): number {
  return ability.manaAdded;
}

/**
 * Clear mana at end of combat
 * Rule 702.189a
 * @param ability - Firebending ability
 * @returns Ability with mana cleared
 */
export function clearFirebendingMana(ability: FirebendingAbility): FirebendingAbility {
  return {
    ...ability,
    manaAdded: 0,
  };
}

/**
 * Multiple instances of firebending are not redundant
 * @param abilities - Array of firebending abilities
 * @returns False
 */
export function hasRedundantFirebending(abilities: readonly FirebendingAbility[]): boolean {
  return false;
}
