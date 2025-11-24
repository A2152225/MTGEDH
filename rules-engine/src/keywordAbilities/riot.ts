/**
 * Riot keyword ability (Rule 702.136)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.136. Riot
 * 702.136a Riot is a static ability. "Riot" means "You may have this permanent enter with an 
 * additional +1/+1 counter on it. If you don't, it gains haste."
 * 702.136b If a permanent has multiple instances of riot, each works separately.
 */

export interface RiotAbility {
  readonly type: 'riot';
  readonly source: string;
  readonly choseCounter: boolean | null; // null = not yet chosen
  readonly hasHaste: boolean;
}

/**
 * Create a riot ability
 * Rule 702.136a
 * @param source - The permanent with riot
 * @returns Riot ability object
 */
export function riot(source: string): RiotAbility {
  return {
    type: 'riot',
    source,
    choseCounter: null,
    hasHaste: false,
  };
}

/**
 * Choose to enter with +1/+1 counter
 * Rule 702.136a
 * @param ability - Riot ability
 * @returns Updated ability
 */
export function chooseRiotCounter(ability: RiotAbility): RiotAbility {
  return {
    ...ability,
    choseCounter: true,
    hasHaste: false,
  };
}

/**
 * Choose to gain haste instead of counter
 * Rule 702.136a
 * @param ability - Riot ability
 * @returns Updated ability
 */
export function chooseRiotHaste(ability: RiotAbility): RiotAbility {
  return {
    ...ability,
    choseCounter: false,
    hasHaste: true,
  };
}

/**
 * Check if counter was chosen
 * @param ability - Riot ability
 * @returns True if counter was chosen
 */
export function choseCounter(ability: RiotAbility): boolean {
  return ability.choseCounter === true;
}

/**
 * Check if haste was chosen
 * @param ability - Riot ability
 * @returns True if haste was chosen
 */
export function hasHasteFromRiot(ability: RiotAbility): boolean {
  return ability.hasHaste;
}

/**
 * Multiple instances of riot work separately
 * Rule 702.136b
 * @param abilities - Array of riot abilities
 * @returns False - each works separately
 */
export function hasRedundantRiot(abilities: readonly RiotAbility[]): boolean {
  return false; // Each instance works separately
}
