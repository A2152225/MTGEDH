/**
 * Improvise keyword ability (Rule 702.126)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.126. Improvise
 * 702.126a Improvise is a static ability that functions while the spell with improvise is on 
 * the stack. "Improvise" means "For each generic mana in this spell's total cost, you may tap 
 * an untapped artifact you control rather than pay that mana."
 * 702.126b The improvise ability isn't an additional or alternative cost and applies only after 
 * the total cost of the spell with improvise is determined.
 * 702.126c Multiple instances of improvise on the same spell are redundant.
 */

export interface ImproviseAbility {
  readonly type: 'improvise';
  readonly source: string;
  readonly artifactsTapped: readonly string[];
}

/**
 * Create an improvise ability
 * Rule 702.126a
 * @param source - The spell with improvise
 * @returns Improvise ability object
 */
export function improvise(source: string): ImproviseAbility {
  return {
    type: 'improvise',
    source,
    artifactsTapped: [],
  };
}

/**
 * Tap artifacts to pay for spell with improvise
 * Rule 702.126a - Each artifact pays for {1}
 * @param ability - Improvise ability
 * @param artifactIds - IDs of artifacts to tap
 * @returns Updated ability
 */
export function tapArtifactsForImprovise(
  ability: ImproviseAbility,
  artifactIds: readonly string[]
): ImproviseAbility {
  return {
    ...ability,
    artifactsTapped: artifactIds,
  };
}

/**
 * Get artifacts tapped for improvise
 * @param ability - Improvise ability
 * @returns IDs of tapped artifacts
 */
export function getImprovisedArtifacts(ability: ImproviseAbility): readonly string[] {
  return ability.artifactsTapped;
}

/**
 * Calculate mana paid via improvise
 * Rule 702.126a - Each artifact pays for {1} generic mana
 * @param ability - Improvise ability
 * @returns Amount of generic mana paid
 */
export function getImproviseManaValue(ability: ImproviseAbility): number {
  return ability.artifactsTapped.length;
}

/**
 * Multiple instances of improvise are redundant
 * Rule 702.126c
 * @param abilities - Array of improvise abilities
 * @returns True if more than one instance
 */
export function hasRedundantImprovise(abilities: readonly ImproviseAbility[]): boolean {
  return abilities.length > 1;
}
