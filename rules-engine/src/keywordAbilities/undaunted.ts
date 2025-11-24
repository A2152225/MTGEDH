/**
 * Undaunted keyword ability (Rule 702.125)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.125. Undaunted
 * 702.125a Undaunted is a static ability that functions while the spell with undaunted is on 
 * the stack. Undaunted means "This spell costs {1} less to cast for each opponent you have."
 * 702.125b Players who have left the game are not counted when determining how many opponents 
 * you have.
 * 702.125c If a spell has multiple instances of undaunted, each of them applies.
 */

export interface UndauntedAbility {
  readonly type: 'undaunted';
  readonly source: string;
  readonly costReduction: number;
}

/**
 * Create an undaunted ability
 * Rule 702.125a
 * @param source - The spell with undaunted
 * @returns Undaunted ability object
 */
export function undaunted(source: string): UndauntedAbility {
  return {
    type: 'undaunted',
    source,
    costReduction: 0,
  };
}

/**
 * Calculate cost reduction from undaunted
 * Rule 702.125a - Costs {1} less per opponent
 * @param numberOfOpponents - Number of opponents (excluding those who left)
 * @returns Cost reduction amount
 */
export function calculateUndauntedReduction(numberOfOpponents: number): number {
  return numberOfOpponents;
}

/**
 * Apply undaunted cost reduction
 * Rule 702.125a
 * @param ability - Undaunted ability
 * @param numberOfOpponents - Number of opponents
 * @returns Updated ability with cost reduction
 */
export function applyUndaunted(ability: UndauntedAbility, numberOfOpponents: number): UndauntedAbility {
  return {
    ...ability,
    costReduction: calculateUndauntedReduction(numberOfOpponents),
  };
}

/**
 * Get total cost reduction
 * @param ability - Undaunted ability
 * @returns Cost reduction amount
 */
export function getUndauntedReduction(ability: UndauntedAbility): number {
  return ability.costReduction;
}

/**
 * Multiple instances of undaunted each apply
 * Rule 702.125c
 * @param abilities - Array of undaunted abilities
 * @returns False - each instance applies
 */
export function hasRedundantUndaunted(abilities: readonly UndauntedAbility[]): boolean {
  return false; // Each instance applies separately
}
