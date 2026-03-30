/**
 * Solved keyword ability (Rule 702.169)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.169. Solved
 * 702.169a Solved is a keyword ability found on Case cards. "Solved" is followed by ability text. 
 * Together, they represent a static ability, a triggered ability, or an activated ability.
 * 702.169b For a static ability, "Solved — [Ability text]" means "As long as this Case is solved, 
 * [ability text]."
 * 702.169c For a triggered ability, "Solved — [Ability text]" means "[Ability text]. This ability 
 * triggers only if this Case is solved."
 * 702.169d For an activated ability, "Solved — [Ability text]" means "[Ability text]. Activate 
 * only if this Case is solved."
 */

export interface SolvedAbility {
  readonly type: 'solved';
  readonly source: string;
  readonly abilityType: 'static' | 'triggered' | 'activated';
  readonly abilityText: string;
  readonly isSolved: boolean;
}

export interface SolvedSummary {
  readonly source: string;
  readonly abilityType: 'static' | 'triggered' | 'activated';
  readonly isSolved: boolean;
  readonly canUseAbility: boolean;
  readonly abilityText: string;
}

/**
 * Create a solved ability
 * Rule 702.169a
 * @param source - The Case with solved
 * @param abilityType - Type of ability (static, triggered, or activated)
 * @param abilityText - Text of the ability
 * @returns Solved ability object
 */
export function solved(
  source: string,
  abilityType: 'static' | 'triggered' | 'activated',
  abilityText: string
): SolvedAbility {
  return {
    type: 'solved',
    source,
    abilityType,
    abilityText,
    isSolved: false,
  };
}

/**
 * Mark Case as solved
 * @param ability - Solved ability
 * @returns Updated ability
 */
export function solveCase(ability: SolvedAbility): SolvedAbility {
  return {
    ...ability,
    isSolved: true,
  };
}

/**
 * Mark Case as unsolved
 * @param ability - Solved ability
 * @returns Updated ability
 */
export function unsolveCase(ability: SolvedAbility): SolvedAbility {
  return {
    ...ability,
    isSolved: false,
  };
}

/**
 * Check if ability is active
 * Rule 702.169b/c/d - Only active if Case is solved
 * @param ability - Solved ability
 * @returns True if ability is active
 */
export function isSolvedAbilityActive(ability: SolvedAbility): boolean {
  return ability.isSolved;
}

/**
 * Check if Case is solved
 * @param ability - Solved ability
 * @returns True if solved
 */
export function isCaseSolved(ability: SolvedAbility): boolean {
  return ability.isSolved;
}

/**
 * A solved ability can only be used in its matching mode once the Case is solved.
 */
export function canUseSolvedAbility(
  ability: SolvedAbility,
  requestedType: 'static' | 'triggered' | 'activated',
): boolean {
  return ability.isSolved && ability.abilityType === requestedType;
}

/**
 * Return the rules text gated by solved.
 */
export function getSolvedAbilityText(ability: SolvedAbility): string {
  return ability.abilityText;
}

/**
 * Multiple instances of solved are not redundant
 * @param abilities - Array of solved abilities
 * @returns False
 */
export function hasRedundantSolved(abilities: readonly SolvedAbility[]): boolean {
  return false;
}

export function createSolvedSummary(
  ability: SolvedAbility,
  requestedType: 'static' | 'triggered' | 'activated',
): SolvedSummary {
  return {
    source: ability.source,
    abilityType: ability.abilityType,
    isSolved: ability.isSolved,
    canUseAbility: canUseSolvedAbility(ability, requestedType),
    abilityText: ability.abilityText,
  };
}
