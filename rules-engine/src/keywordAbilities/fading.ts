/**
 * Fading keyword ability implementation
 * Rule 702.32
 * 
 * Fading is a keyword that represents two abilities.
 */

/**
 * Fading ability
 * Rule 702.32a
 * 
 * "Fading N" means "This permanent enters the battlefield with N fade counters on it" and
 * "At the beginning of your upkeep, remove a fade counter from this permanent.
 * If you can't, sacrifice it."
 */
export interface FadingAbility {
  readonly type: 'fading';
  readonly initialCounters: number;
  readonly source: string;
  readonly fadeCounters: number;
}

/**
 * Creates a fading ability
 * Rule 702.32a
 * 
 * @param source - The permanent with fading
 * @param initialCounters - Number of fade counters it enters with
 * @returns Fading ability
 */
export function fading(source: string, initialCounters: number): FadingAbility {
  return {
    type: 'fading',
    initialCounters,
    source,
    fadeCounters: initialCounters,
  };
}

/**
 * Removes a fade counter during upkeep
 * Rule 702.32a
 * 
 * @param ability - The fading ability
 * @returns Updated ability with one fewer counter, or null if should be sacrificed
 */
export function removeFadeCounter(ability: FadingAbility): FadingAbility | null {
  if (ability.fadeCounters === 0) {
    return null; // Sacrifice the permanent
  }
  return {
    ...ability,
    fadeCounters: ability.fadeCounters - 1,
  };
}

/**
 * Checks if permanent should be sacrificed
 * Rule 702.32a
 * 
 * @param ability - The fading ability
 * @returns True if no fade counters remain
 */
export function shouldSacrificeForFading(ability: FadingAbility): boolean {
  return ability.fadeCounters === 0;
}

/**
 * Checks if multiple fading abilities are redundant
 * Rule 702.32b - Multiple instances of fading are redundant
 * 
 * @param abilities - Array of fading abilities
 * @returns True if more than one fading
 */
export function hasRedundantFading(abilities: readonly FadingAbility[]): boolean {
  return abilities.length > 1;
}
