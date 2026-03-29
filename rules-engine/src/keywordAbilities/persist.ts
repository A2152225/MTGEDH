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
 * Checks whether persist can return the creature from the graveyard.
 *
 * @param ability - The persist ability
 * @param zone - The permanent's current zone
 * @param minusCounters - The number of -1/-1 counters it had when it died
 * @returns True if persist can return the creature
 */
export function canReturnWithPersist(
  ability: PersistAbility,
  zone: string,
  minusCounters: number
): boolean {
  return zone === 'graveyard' && shouldPersistTrigger(ability, minusCounters);
}

/**
 * Creates the result of a persist return.
 *
 * @param ability - The persist ability
 * @param zone - The permanent's current zone
 * @param minusCounters - The number of -1/-1 counters it had when it died
 * @returns Return summary, or null if persist cannot return it
 */
export function createPersistReturnResult(
  ability: PersistAbility,
  zone: string,
  minusCounters: number
): {
  source: string;
  fromZone: 'graveyard';
  toZone: 'battlefield';
  minusOneMinusOneCountersAdded: 1;
} | null {
  if (!canReturnWithPersist(ability, zone, minusCounters)) {
    return null;
  }

  return {
    source: ability.source,
    fromZone: 'graveyard',
    toZone: 'battlefield',
    minusOneMinusOneCountersAdded: 1,
  };
}

/**
 * Check if two persist abilities are redundant
 * Multiple instances are redundant
 */
export function arePersistAbilitiesRedundant(a: PersistAbility, b: PersistAbility): boolean {
  return true;
}
