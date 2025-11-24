/**
 * Replicate keyword ability (Rule 702.56)
 * 
 * @module keywordAbilities/replicate
 */

/**
 * Represents a replicate ability on a spell.
 * Rule 702.56: Replicate is a keyword that represents two abilities. The first is a static 
 * ability that functions while the spell with replicate is on the stack. The second is a 
 * triggered ability that functions while the spell with replicate is on the stack.
 */
export interface ReplicateAbility {
  readonly type: 'replicate';
  readonly cost: string;
  readonly source: string;
  readonly timesPaid: number;
}

/**
 * Creates a replicate ability.
 * 
 * @param source - The source object with replicate
 * @param cost - The replicate cost
 * @returns A replicate ability
 * 
 * @example
 * ```typescript
 * const ability = replicate('Pyromatics', '{1}{R}');
 * ```
 */
export function replicate(source: string, cost: string): ReplicateAbility {
  return {
    type: 'replicate',
    cost,
    source,
    timesPaid: 0
  };
}

/**
 * Records that replicate cost was paid.
 * 
 * @param ability - The replicate ability
 * @param times - Number of times paid (default 1)
 * @returns Updated ability
 */
export function payReplicate(ability: ReplicateAbility, times: number = 1): ReplicateAbility {
  return {
    ...ability,
    timesPaid: ability.timesPaid + times
  };
}

/**
 * Gets the number of copies to create.
 * 
 * @param ability - The replicate ability
 * @returns Number of copies
 */
export function getReplicateCopies(ability: ReplicateAbility): number {
  return ability.timesPaid;
}
