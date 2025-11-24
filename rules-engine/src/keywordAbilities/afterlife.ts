/**
 * Afterlife keyword ability (Rule 702.135)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.135. Afterlife
 * 702.135a Afterlife is a triggered ability. "Afterlife N" means "When this permanent is put 
 * into a graveyard from the battlefield, create N 1/1 white and black Spirit creature tokens 
 * with flying."
 * 702.135b If a permanent has multiple instances of afterlife, each triggers separately.
 */

export interface AfterlifeAbility {
  readonly type: 'afterlife';
  readonly source: string;
  readonly afterlifeValue: number;
  readonly hasTriggered: boolean;
  readonly tokensCreated: readonly string[];
}

/**
 * Create an afterlife ability
 * Rule 702.135a
 * @param source - The permanent with afterlife
 * @param afterlifeValue - Number of Spirit tokens to create
 * @returns Afterlife ability object
 */
export function afterlife(source: string, afterlifeValue: number): AfterlifeAbility {
  return {
    type: 'afterlife',
    source,
    afterlifeValue,
    hasTriggered: false,
    tokensCreated: [],
  };
}

/**
 * Trigger afterlife when permanent dies
 * Rule 702.135a - Create N 1/1 Spirit tokens
 * @param ability - Afterlife ability
 * @param tokenIds - IDs of created Spirit tokens
 * @returns Updated ability
 */
export function triggerAfterlife(ability: AfterlifeAbility, tokenIds: readonly string[]): AfterlifeAbility {
  return {
    ...ability,
    hasTriggered: true,
    tokensCreated: tokenIds,
  };
}

/**
 * Get afterlife value (number of tokens)
 * @param ability - Afterlife ability
 * @returns Number of Spirit tokens to create
 */
export function getAfterlifeValue(ability: AfterlifeAbility): number {
  return ability.afterlifeValue;
}

/**
 * Get created Spirit tokens
 * @param ability - Afterlife ability
 * @returns IDs of Spirit tokens
 */
export function getAfterlifeTokens(ability: AfterlifeAbility): readonly string[] {
  return ability.tokensCreated;
}

/**
 * Multiple instances of afterlife trigger separately
 * Rule 702.135b
 * @param abilities - Array of afterlife abilities
 * @returns False - each instance triggers separately
 */
export function hasRedundantAfterlife(abilities: readonly AfterlifeAbility[]): boolean {
  return false; // Each instance triggers separately
}
