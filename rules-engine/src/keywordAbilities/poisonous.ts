/**
 * Poisonous keyword ability (Rule 702.70)
 * 
 * @module keywordAbilities/poisonous
 */

/**
 * Represents a poisonous ability on a creature.
 * Rule 702.70: Poisonous is a triggered ability. "Poisonous N" means "Whenever this 
 * creature deals combat damage to a player, that player gets N poison counters."
 */
export interface PoisonousAbility {
  readonly type: 'poisonous';
  readonly count: number;
  readonly source: string;
}

/**
 * Creates a poisonous ability.
 * 
 * @param source - The source creature with poisonous
 * @param count - Number of poison counters (poisonous N)
 * @returns A poisonous ability
 * 
 * @example
 * ```typescript
 * const ability = poisonous('Virulent Sliver', 1);
 * ```
 */
export function poisonous(source: string, count: number): PoisonousAbility {
  return {
    type: 'poisonous',
    count,
    source
  };
}

/**
 * Gets the number of poison counters to give.
 * 
 * @param ability - The poisonous ability
 * @returns Number of poison counters
 */
export function getPoisonCounters(ability: PoisonousAbility): number {
  return ability.count;
}
