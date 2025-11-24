/**
 * Impending keyword ability (Rule 702.176)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.176. Impending
 * 702.176a Impending is a keyword that represents four abilities. The first is a static ability 
 * that functions while the spell with impending is on the stack. The second is static ability that 
 * creates a replacement effect that may apply to the permanent with impending as it enters the 
 * battlefield from the stack. The third is a static ability that functions on the battlefield. The 
 * fourth is a triggered ability that functions on the battlefield. "Impending N—[cost]" means "You 
 * may choose to pay [cost] rather than pay this spell's mana cost," "If you chose to pay this 
 * permanent's impending cost, it enters with N time counters on it," "As long as this permanent's 
 * impending cost was paid and it has a time counter on it, it's not a creature," and "At the 
 * beginning of your end step, if this permanent's impending cost was paid and it has a time counter 
 * on it, remove a time counter from it."
 */

export interface ImpendingAbility {
  readonly type: 'impending';
  readonly source: string;
  readonly impendingCost: string;
  readonly timeCounters: number;
  readonly wasImpending: boolean;
  readonly currentTimeCounters: number;
}

/**
 * Create an impending ability
 * Rule 702.176a
 * @param source - The spell with impending
 * @param impendingCost - Alternative cost
 * @param timeCounters - Number of time counters (N)
 * @returns Impending ability object
 */
export function impending(source: string, impendingCost: string, timeCounters: number): ImpendingAbility {
  return {
    type: 'impending',
    source,
    impendingCost,
    timeCounters,
    wasImpending: false,
    currentTimeCounters: 0,
  };
}

/**
 * Cast with impending cost
 * Rule 702.176a - Alternative cost, enters with time counters
 * @param ability - Impending ability
 * @returns Updated ability
 */
export function castImpending(ability: ImpendingAbility): ImpendingAbility {
  return {
    ...ability,
    wasImpending: true,
    currentTimeCounters: ability.timeCounters,
  };
}

/**
 * Check if is a creature
 * Rule 702.176a - Not a creature while has time counter
 * @param ability - Impending ability
 * @returns True if is a creature
 */
export function isCreatureWithImpending(ability: ImpendingAbility): boolean {
  if (!ability.wasImpending) {
    return true; // Not cast with impending, so is a creature
  }
  return ability.currentTimeCounters === 0;
}

/**
 * Remove time counter at end step
 * Rule 702.176a
 * @param ability - Impending ability
 * @returns Updated ability
 */
export function removeImpendingCounter(ability: ImpendingAbility): ImpendingAbility {
  if (ability.currentTimeCounters > 0) {
    return {
      ...ability,
      currentTimeCounters: ability.currentTimeCounters - 1,
    };
  }
  return ability;
}

/**
 * Multiple instances of impending are not redundant
 * @param abilities - Array of impending abilities
 * @returns False
 */
export function hasRedundantImpending(abilities: readonly ImpendingAbility[]): boolean {
  return false;
}
