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

export interface SuspendUpkeepResult {
  readonly ability: SuspendAbility;
  readonly removedCounter: boolean;
  readonly lastCounterRemoved: boolean;
  readonly canCast: boolean;
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

/**
 * Processes a suspend upkeep trigger by removing one time counter if possible.
 *
 * @param ability - The suspend ability
 * @returns Upkeep result including whether the card can now be cast
 */
export function processSuspendUpkeep(ability: SuspendAbility): SuspendUpkeepResult {
  if (ability.timeCounters <= 0) {
    return {
      ability,
      removedCounter: false,
      lastCounterRemoved: false,
      canCast: true,
    };
  }

  const updatedAbility = removeTimeCounter(ability);
  return {
    ability: updatedAbility,
    removedCounter: true,
    lastCounterRemoved: updatedAbility.timeCounters === 0,
    canCast: canCastSuspended(updatedAbility),
  };
}

/**
 * Checks if a suspended card may be cast from the given zone.
 * Suspend only allows casting from exile after the last time counter is removed.
 *
 * @param ability - The suspend ability
 * @param zone - The card's current zone
 * @returns True if the card may be cast from exile
 */
export function canCastSuspendedFromZone(ability: SuspendAbility, zone: string): boolean {
  return zone === 'exile' && canCastSuspended(ability);
}

/**
 * Creates the result of casting a suspended card.
 *
 * @param ability - The suspend ability
 * @param zone - The card's current zone
 * @returns Cast summary, or null if the card cannot be cast yet
 */
export function createSuspendedCastResult(
  ability: SuspendAbility,
  zone: string
): {
  source: string;
  fromZone: 'exile';
  withoutPayingManaCost: true;
} | null {
  if (!canCastSuspendedFromZone(ability, zone)) {
    return null;
  }

  return {
    source: ability.source,
    fromZone: 'exile',
    withoutPayingManaCost: true,
  };
}
