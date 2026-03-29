/**
 * Reinforce keyword ability (Rule 702.77)
 * @module keywordAbilities/reinforce
 */

/**
 * Reinforce ability (Rule 702.77)
 * Activated ability that functions from hand
 */
export interface ReinforceAbility {
  readonly type: 'reinforce';
  readonly source: string;
  readonly count: number;
  readonly cost: string;
}

/**
 * Create a reinforce ability
 * Rule 702.77a: "Reinforce N—[cost]" means "[Cost], Discard this card:
 * Put N +1/+1 counters on target creature."
 */
export function reinforce(source: string, count: number, cost: string): ReinforceAbility {
  return {
    type: 'reinforce',
    source,
    count,
    cost
  };
}

/**
 * Activate reinforce ability
 * Returns the number of counters to add
 */
export function activateReinforce(ability: ReinforceAbility, targetCreature: string): number {
  return ability.count;
}

/**
 * Check if reinforce can be activated
 * Can only be activated from hand
 */
export function canActivateReinforce(ability: ReinforceAbility, zone: string): boolean {
  return zone === 'hand';
}

/**
 * Creates the activation result for reinforce.
 *
 * @param ability - The reinforce ability
 * @param zone - The card's current zone
 * @param targetCreature - The creature receiving counters
 * @returns Activation summary, or null if reinforce cannot be activated
 */
export function createReinforceActivationResult(
  ability: ReinforceAbility,
  zone: string,
  targetCreature?: string
): {
  source: string;
  fromZone: 'hand';
  targetCreature: string;
  countersAdded: number;
  costPaid: string;
} | null {
  if (!canActivateReinforce(ability, zone) || !targetCreature) {
    return null;
  }

  return {
    source: ability.source,
    fromZone: 'hand',
    targetCreature,
    countersAdded: ability.count,
    costPaid: ability.cost,
  };
}

/**
 * Check if two reinforce abilities are redundant
 * Multiple instances are not redundant
 */
export function areReinforceAbilitiesRedundant(a: ReinforceAbility, b: ReinforceAbility): boolean {
  return a.count === b.count && a.cost === b.cost;
}
