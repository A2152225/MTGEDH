/**
 * Suspend keyword ability (Rule 702.62)
 * 
 * @module keywordAbilities/suspend
 */

/**
 * Represents a suspend ability on a card.
 * Rule 702.62: Suspend is a keyword that represents three abilities. The first is a 
 * static ability that functions while the card with suspend is in a player's hand. 
 * The second and third are triggered abilities that function in the exile zone.
 */
export interface SuspendAbility {
  readonly type: 'suspend';
  readonly count: number;
  readonly cost: string;
  readonly source: string;
  readonly timeCounters: number;
}

/**
 * Creates a suspend ability.
 * 
 * @param source - The source card with suspend
 * @param count - Number of time counters (suspend N)
 * @param cost - The suspend cost
 * @returns A suspend ability
 * 
 * @example
 * ```typescript
 * const ability = suspend('Rift Bolt', 1, '{R}');
 * ```
 */
export function suspend(source: string, count: number, cost: string): SuspendAbility {
  return {
    type: 'suspend',
    count,
    cost,
    source,
    timeCounters: count
  };
}

/**
 * Removes a time counter during upkeep.
 * 
 * @param ability - The suspend ability
 * @returns Updated ability with one less counter
 */
export function removeTimeCounter(ability: SuspendAbility): SuspendAbility {
  return {
    ...ability,
    timeCounters: Math.max(0, ability.timeCounters - 1)
  };
}

/**
 * Checks if the suspended card is ready to cast.
 * 
 * @param ability - The suspend ability
 * @returns True if no time counters remain
 */
export function canCastSuspended(ability: SuspendAbility): boolean {
  return ability.timeCounters === 0;
}
