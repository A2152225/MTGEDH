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
  readonly hasTriggered: boolean;
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
    hasTriggered: false,
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
 * Marks undying as triggered
 * @param ability - Undying ability
 * @returns Updated ability
 */
export function triggerUndying(ability: UndyingAbility): UndyingAbility {
  return {
    ...ability,
    hasTriggered: true,
  };
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
