/**
 * Vanishing keyword ability (Rule 702.63)
 * 
 * @module keywordAbilities/vanishing
 */

/**
 * Represents a vanishing ability on a permanent.
 * Rule 702.63: Vanishing is a keyword that represents three abilities. "Vanishing N" 
 * means "This permanent enters the battlefield with N time counters on it," "At the 
 * beginning of your upkeep, if this permanent has a time counter on it, remove a time 
 * counter from it," and "When the last time counter is removed from this permanent, 
 * sacrifice it."
 */
export interface VanishingAbility {
  readonly type: 'vanishing';
  readonly count: number;
  readonly source: string;
  readonly timeCounters: number;
}

/**
 * Creates a vanishing ability.
 * 
 * @param source - The source permanent with vanishing
 * @param count - Number of time counters (vanishing N)
 * @returns A vanishing ability
 * 
 * @example
 * ```typescript
 * const ability = vanishing('Reality Acid', 3);
 * ```
 */
export function vanishing(source: string, count: number): VanishingAbility {
  return {
    type: 'vanishing',
    count,
    source,
    timeCounters: count
  };
}

/**
 * Removes a time counter during upkeep.
 * 
 * @param ability - The vanishing ability
 * @returns Updated ability with one less counter
 */
export function removeVanishingCounter(ability: VanishingAbility): VanishingAbility {
  if (ability.timeCounters <= 0) {
    return ability;
  }
  
  return {
    ...ability,
    timeCounters: ability.timeCounters - 1
  };
}

/**
 * Checks if the permanent should be sacrificed.
 * 
 * @param ability - The vanishing ability
 * @returns True if no time counters remain
 */
export function shouldSacrificeVanishing(ability: VanishingAbility): boolean {
  return ability.timeCounters === 0;
}
