/**
 * Annihilator keyword ability (Rule 702.86)
 * @module keywordAbilities/annihilator
 */

/**
 * Annihilator ability (Rule 702.86)
 * Triggered ability that forces defending player to sacrifice permanents
 */
export interface AnnihilatorAbility {
  readonly type: 'annihilator';
  readonly source: string;
  readonly count: number;
}

/**
 * Create an annihilator ability
 * Rule 702.86a: "Annihilator N" means "Whenever this creature attacks,
 * defending player sacrifices N permanents."
 */
export function annihilator(source: string, count: number): AnnihilatorAbility {
  return {
    type: 'annihilator',
    source,
    count
  };
}

/**
 * Get number of permanents to sacrifice
 */
export function getAnnihilatorCount(ability: AnnihilatorAbility): number {
  return ability.count;
}

/**
 * Check if two annihilator abilities are redundant
 * Rule 702.86b: Multiple instances trigger separately
 */
export function areAnnihilatorAbilitiesRedundant(a: AnnihilatorAbility, b: AnnihilatorAbility): boolean {
  return false;
}
