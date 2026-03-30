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
 * Result of processing a fading upkeep trigger.
 */
export interface FadingUpkeepResult {
  readonly ability: FadingAbility | null;
  readonly removedCounter: boolean;
  readonly sacrificed: boolean;
  readonly countersRemaining: number;
}

export interface FadingSummary {
  readonly source: string;
  readonly initialCounters: number;
  readonly countersRemaining: number;
  readonly canRemoveCounter: boolean;
  readonly shouldSacrifice: boolean;
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
 * Checks whether a fade counter can be removed this upkeep.
 */
export function canRemoveFadeCounter(ability: FadingAbility): boolean {
  return ability.fadeCounters > 0;
}

/**
 * Processes fading's upkeep trigger according to rule 702.32a.
 */
export function processFadingUpkeep(ability: FadingAbility): FadingUpkeepResult {
  if (!canRemoveFadeCounter(ability)) {
    return {
      ability: null,
      removedCounter: false,
      sacrificed: true,
      countersRemaining: 0,
    };
  }

  const updatedAbility = removeFadeCounter(ability)!;

  return {
    ability: updatedAbility,
    removedCounter: true,
    sacrificed: false,
    countersRemaining: updatedAbility.fadeCounters,
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

export function createFadingSummary(ability: FadingAbility): FadingSummary {
  return {
    source: ability.source,
    initialCounters: ability.initialCounters,
    countersRemaining: ability.fadeCounters,
    canRemoveCounter: canRemoveFadeCounter(ability),
    shouldSacrifice: shouldSacrificeForFading(ability),
  };
}
