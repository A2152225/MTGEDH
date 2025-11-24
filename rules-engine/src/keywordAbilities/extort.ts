/**
 * Extort keyword ability implementation (Rule 702.101)
 * 
 * From MTG Comprehensive Rules (Nov 2025):
 * 702.101a Extort is a triggered ability. "Extort" means "Whenever you cast a spell,
 * you may pay {W/B}. If you do, each opponent loses 1 life and you gain life equal to
 * the total life lost this way."
 * 
 * 702.101b If a permanent has multiple instances of extort, each triggers separately.
 */

/**
 * Extort ability interface
 */
export interface ExtortAbility {
  readonly type: 'extort';
  readonly source: string;
  readonly timesPaid: number;
}

/**
 * Creates an extort ability
 * @param source - Source permanent with extort
 * @returns Extort ability
 */
export function extort(source: string): ExtortAbility {
  return {
    type: 'extort',
    source,
    timesPaid: 0,
  };
}

/**
 * Pays for extort trigger
 * @param ability - Extort ability
 * @param opponentCount - Number of opponents
 * @returns Updated extort ability with life totals affected
 */
export function payExtortCost(
  ability: ExtortAbility,
  opponentCount: number
): ExtortAbility {
  return {
    ...ability,
    timesPaid: ability.timesPaid + 1,
  };
}

/**
 * Calculates life gained from extort
 * @param opponentCount - Number of opponents
 * @returns Life gained (equals life lost by all opponents)
 */
export function calculateExtortLifeGain(opponentCount: number): number {
  return opponentCount; // Each opponent loses 1
}

/**
 * Gets total times extort has been paid for
 * @param ability - Extort ability
 * @returns Times paid count
 */
export function getExtortCount(ability: ExtortAbility): number {
  return ability.timesPaid;
}
