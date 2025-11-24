/**
 * Menace keyword ability (Rule 702.111)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.111. Menace
 * 702.111a Menace is an evasion ability.
 * 702.111b A creature with menace can't be blocked except by two or more creatures. (See 
 * rule 509, "Declare Blockers Step.")
 * 702.111c Multiple instances of menace on the same creature are redundant.
 */

export interface MenaceAbility {
  readonly type: 'menace';
  readonly source: string;
}

/**
 * Create a menace ability
 * Rule 702.111
 */
export function menace(source: string): MenaceAbility {
  return {
    type: 'menace',
    source,
  };
}

/**
 * Check if creature with menace can be blocked by a given number of blockers
 * Rule 702.111b - Requires 2 or more blockers
 */
export function canBlockMenace(blockerCount: number): boolean {
  return blockerCount >= 2;
}

/**
 * Get minimum blockers required
 * Rule 702.111b
 */
export function getMinimumBlockers(): number {
  return 2;
}

/**
 * Check if a creature has menace
 */
export function hasMenace(abilities: readonly MenaceAbility[]): boolean {
  return abilities.length > 0;
}

/**
 * Multiple instances of menace are redundant
 * Rule 702.111c
 */
export function hasRedundantMenace(
  abilities: readonly MenaceAbility[]
): boolean {
  return abilities.length > 1;
}
