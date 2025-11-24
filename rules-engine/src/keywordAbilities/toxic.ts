/**
 * Toxic keyword ability (Rule 702.164)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.164. Toxic
 * 702.164a Toxic is a static ability. It is written "toxic N," where N is a number.
 * 702.164b Some rules and effects refer to a creature's "total toxic value." A creature's total 
 * toxic value is the sum of all N values of toxic abilities that creature has.
 * 702.164c Combat damage dealt to a player by a creature with toxic causes that creature's 
 * controller to give the player a number of poison counters equal to that creature's total toxic 
 * value, in addition to the damage's other results.
 */

export interface ToxicAbility {
  readonly type: 'toxic';
  readonly source: string;
  readonly toxicValue: number;
}

/**
 * Create a toxic ability
 * Rule 702.164a
 * @param source - The creature with toxic
 * @param toxicValue - Number of poison counters to give
 * @returns Toxic ability object
 */
export function toxic(source: string, toxicValue: number): ToxicAbility {
  return {
    type: 'toxic',
    source,
    toxicValue,
  };
}

/**
 * Get total toxic value
 * Rule 702.164b - Sum of all N values
 * @param abilities - Array of toxic abilities
 * @returns Total toxic value
 */
export function getTotalToxicValue(abilities: readonly ToxicAbility[]): number {
  return abilities.reduce((sum, ability) => sum + ability.toxicValue, 0);
}

/**
 * Get toxic value for single ability
 * @param ability - Toxic ability
 * @returns Toxic value
 */
export function getToxicValue(ability: ToxicAbility): number {
  return ability.toxicValue;
}

/**
 * Multiple instances of toxic are not redundant
 * Rule 702.164b - They stack
 * @param abilities - Array of toxic abilities
 * @returns False - they stack to total toxic value
 */
export function hasRedundantToxic(abilities: readonly ToxicAbility[]): boolean {
  return false; // Each instance contributes to total toxic value
}
