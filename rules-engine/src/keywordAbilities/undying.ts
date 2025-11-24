/**
 * Undying keyword ability implementation (Rule 702.93)
 * 
 * @see MagicCompRules 20251114.txt - Rule 702.93
 */

/**
 * Undying ability interface
 * Rule 702.93a: When this creature dies, if it had no +1/+1 counters,
 * return it to battlefield with a +1/+1 counter
 */
export interface UndyingAbility {
  readonly type: 'undying';
  readonly source: string;
  readonly hasReturned: boolean;
}

/**
 * Creates an undying ability
 * @param source - The source permanent
 * @returns Undying ability object
 */
export function undying(source: string): UndyingAbility {
  return {
    type: 'undying',
    source,
    hasReturned: false,
  };
}

/**
 * Checks if undying can trigger
 * @param hadPlusOneCounters - Whether creature had +1/+1 counters when it died
 * @returns True if undying triggers
 */
export function canTriggerUndying(hadPlusOneCounters: boolean): boolean {
  return !hadPlusOneCounters;
}

/**
 * Returns creature to battlefield with +1/+1 counter
 * Rule 702.93a
 * @param ability - Undying ability
 * @returns Updated ability with hasReturned marked true
 * @throws Error if ability has already returned
 */
export function returnWithCounter(ability: UndyingAbility): UndyingAbility {
  if (ability.hasReturned) {
    throw new Error('Undying has already been used');
  }
  return {
    ...ability,
    hasReturned: true,
  };
}

/**
 * Checks if a creature has undying
 * @param ability - Undying ability
 * @returns True if the ability exists
 */
export function hasUndying(ability: UndyingAbility): boolean {
  return ability.type === 'undying';
}

/**
 * Checks if multiple undying instances are redundant
 * Multiple instances each trigger separately (Rule 702.93b)
 * @param abilities - Array of undying abilities
 * @returns False - multiple instances are not redundant
 */
export function hasRedundantUndying(abilities: readonly UndyingAbility[]): boolean {
  // Rule 702.93b: Multiple instances each trigger separately
  return false;
}
