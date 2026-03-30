/**
 * First Strike - Rule 702.7
 * 
 * A creature with first strike deals combat damage before creatures without first strike.
 */

/**
 * Represents the first strike keyword ability
 * Rule 702.7
 */
export interface FirstStrikeAbility {
  readonly type: 'firstStrike';
  readonly source: string; // ID of the object with first strike
}

export interface FirstStrikeCombatResult {
  readonly source: string;
  readonly dealsInFirstStep: boolean;
  readonly dealsInSecondStep: boolean;
}

/**
 * Create a first strike ability
 * Rule 702.7a - First strike is a static ability that modifies the rules for the combat damage step
 * 
 * @param source - ID of the object with first strike
 * @returns First strike ability
 */
export function firstStrike(source: string): FirstStrikeAbility {
  return {
    type: 'firstStrike',
    source,
  };
}

export function dealsOnlyInFirstStrikeStep(
  hasFirstStrike: boolean,
  hasDoubleStrike: boolean = false
): boolean {
  return hasFirstStrike && !hasDoubleStrike;
}

export function createFirstStrikeCombatResult(
  ability: FirstStrikeAbility,
  hasDoubleStrike: boolean = false
): FirstStrikeCombatResult {
  return {
    source: ability.source,
    dealsInFirstStep: true,
    dealsInSecondStep: hasDoubleStrike,
  };
}

/**
 * Check if multiple first strike abilities are redundant
 * Rule 702.7d - Multiple instances of first strike on the same creature are redundant
 * 
 * @param abilities - Array of first strike abilities
 * @returns true if there are redundant instances
 */
export function hasRedundantFirstStrike(abilities: readonly FirstStrikeAbility[]): boolean {
  return abilities.length > 1;
}
