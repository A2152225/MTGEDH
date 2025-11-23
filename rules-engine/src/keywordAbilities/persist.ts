/**
 * Persist keyword ability (Rule 702.79)
 * @module keywordAbilities/persist
 */

/**
 * Persist ability (Rule 702.79)
 * Triggered ability that returns creature from graveyard with -1/-1 counter
 */
export interface PersistAbility {
  readonly type: 'persist';
  readonly source: string;
}

/**
 * Create a persist ability
 * Rule 702.79a: "Persist" means "When this permanent is put into a graveyard
 * from the battlefield, if it had no -1/-1 counters on it, return it to the
 * battlefield under its owner's control with a -1/-1 counter on it."
 */
export function persist(source: string): PersistAbility {
  return {
    type: 'persist',
    source
  };
}

/**
 * Check if persist triggers
 * Only triggers if permanent had no -1/-1 counters
 */
export function shouldPersistTrigger(ability: PersistAbility, minusCounters: number): boolean {
  return minusCounters === 0;
}

/**
 * Check if two persist abilities are redundant
 * Multiple instances are redundant
 */
export function arePersistAbilitiesRedundant(a: PersistAbility, b: PersistAbility): boolean {
  return true;
}
