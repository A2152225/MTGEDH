/**
 * Ascend keyword ability (Rule 702.131)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.131. Ascend
 * 702.131a Ascend on an instant or sorcery spell represents a spell ability. It means "If you 
 * control ten or more permanents and you don't have the city's blessing, you get the city's 
 * blessing for the rest of the game."
 * 702.131b Ascend on a permanent represents a static ability. It means "Any time you control 
 * ten or more permanents and you don't have the city's blessing, you get the city's blessing 
 * for the rest of the game."
 * 702.131c The city's blessing is a designation that has no rules meaning other than to act as 
 * a marker that other rules and effects can identify. Any number of players may have the city's 
 * blessing at the same time.
 */

export interface AscendAbility {
  readonly type: 'ascend';
  readonly source: string;
  readonly hasCitysBlessing: boolean;
}

/**
 * Create an ascend ability
 * Rule 702.131
 * @param source - The spell or permanent with ascend
 * @returns Ascend ability object
 */
export function ascend(source: string): AscendAbility {
  return {
    type: 'ascend',
    source,
    hasCitysBlessing: false,
  };
}

/**
 * Check if player should get the city's blessing
 * Rule 702.131a/b - Requires 10+ permanents and not already having it
 * @param permanentsControlled - Number of permanents controlled
 * @param alreadyHasBlessing - Whether player already has city's blessing
 * @returns True if should gain city's blessing
 */
export function shouldGetCitysBlessing(
  permanentsControlled: number,
  alreadyHasBlessing: boolean
): boolean {
  return permanentsControlled >= 10 && !alreadyHasBlessing;
}

/**
 * Grant city's blessing to player
 * Rule 702.131c
 * @param ability - Ascend ability
 * @returns Updated ability
 */
export function grantCitysBlessing(ability: AscendAbility): AscendAbility {
  return {
    ...ability,
    hasCitysBlessing: true,
  };
}

/**
 * Check if has city's blessing
 * Rule 702.131c
 * @param ability - Ascend ability
 * @returns True if has city's blessing
 */
export function hasCitysBlessing(ability: AscendAbility): boolean {
  return ability.hasCitysBlessing;
}

/**
 * Multiple instances of ascend are not redundant
 * @param abilities - Array of ascend abilities
 * @returns False
 */
export function hasRedundantAscend(abilities: readonly AscendAbility[]): boolean {
  return false;
}
