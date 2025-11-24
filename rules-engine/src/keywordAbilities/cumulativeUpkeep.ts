/**
 * Cumulative Upkeep keyword ability implementation
 * Rule 702.24
 * 
 * Cumulative upkeep is a triggered ability that imposes an increasing cost
 * at the beginning of your upkeep.
 */

/**
 * Cumulative upkeep ability
 * Rule 702.24a
 * 
 * At the beginning of your upkeep, if the permanent is controlled by its owner,
 * put an age counter on it. Then you may pay [cost] for each age counter on it.
 * If you don't, sacrifice it.
 */
export interface CumulativeUpkeepAbility {
  readonly type: 'cumulativeUpkeep';
  readonly cost: string; // Cost per age counter (e.g., "{1}", "Sacrifice a creature")
  readonly source: string;
  readonly ageCounters: number;
}

/**
 * Creates a cumulative upkeep ability
 * Rule 702.24a
 * 
 * @param source - The permanent with cumulative upkeep
 * @param cost - The cost per age counter
 * @returns Cumulative upkeep ability
 */
export function cumulativeUpkeep(source: string, cost: string): CumulativeUpkeepAbility {
  return {
    type: 'cumulativeUpkeep',
    cost,
    source,
    ageCounters: 0,
  };
}

/**
 * Adds an age counter during upkeep
 * Rule 702.24a
 * 
 * @param ability - The cumulative upkeep ability
 * @returns Updated ability with additional age counter
 */
export function addAgeCounter(ability: CumulativeUpkeepAbility): CumulativeUpkeepAbility {
  return {
    ...ability,
    ageCounters: ability.ageCounters + 1,
  };
}

/**
 * Calculates total cumulative upkeep cost
 * Rule 702.24a
 * 
 * @param ability - The cumulative upkeep ability
 * @returns Total cost to pay
 */
export function calculateUpkeepCost(ability: CumulativeUpkeepAbility): string {
  return `${ability.cost} × ${ability.ageCounters}`;
}

/**
 * Checks if multiple cumulative upkeep abilities are redundant
 * Rule 702.24b - Each instance triggers separately
 * 
 * @param abilities - Array of cumulative upkeep abilities
 * @returns False (they're not redundant, each triggers separately)
 */
export function hasRedundantCumulativeUpkeep(
  abilities: readonly CumulativeUpkeepAbility[]
): boolean {
  return false; // Each instance triggers separately
}
