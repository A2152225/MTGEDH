/**
 * Affinity keyword ability implementation (Rule 702.41)
 * 
 * @see MagicCompRules 702.41
 */

/**
 * Affinity ability interface
 * Rule 702.41a: "Affinity for [text]" means "This spell costs {1} less to cast for each [text] you control."
 */
export interface AffinityAbility {
  readonly type: 'affinity';
  readonly affinityFor: string;
  readonly source: string;
  readonly reduction: number;
}

/**
 * Creates an Affinity ability
 * 
 * @param source - The source spell ID
 * @param affinityFor - What the affinity is for (e.g., "artifacts", "Plains")
 * @returns AffinityAbility object
 */
export function affinity(source: string, affinityFor: string): AffinityAbility {
  return {
    type: 'affinity',
    affinityFor,
    source,
    reduction: 0,
  };
}

/**
 * Calculates the cost reduction from affinity
 * 
 * @param ability - The affinity ability
 * @param count - Number of matching permanents controlled
 * @returns Updated AffinityAbility with calculated reduction
 */
export function calculateAffinityReduction(
  ability: AffinityAbility,
  count: number
): AffinityAbility {
  return {
    ...ability,
    reduction: count,
  };
}

/**
 * Gets the total cost reduction from affinity
 * 
 * @param ability - The affinity ability
 * @returns Number of generic mana reduced
 */
export function getAffinityReduction(ability: AffinityAbility): number {
  return ability.reduction;
}

/**
 * Checks if affinity abilities are redundant
 * Rule 702.41b: If a spell has multiple instances of affinity, each of them applies
 * 
 * @returns False - affinity instances are never redundant
 */
export function isAffinityRedundant(): boolean {
  return false; // Rule 702.41b: Each instance applies
}
