/**
 * Scavenge keyword ability implementation
 * Rule 702.97 - "Scavenge" means exile this card from your graveyard and put counters on a creature
 */

/**
 * Scavenge ability - Rule 702.97
 * Allows exiling a creature card from graveyard to add +1/+1 counters
 */
export interface ScavengeAbility {
  readonly type: 'scavenge';
  readonly source: string;
  readonly scavengeCost: string;
  readonly powerToughness: readonly [number, number];
  readonly wasScavenged: boolean;
}

/**
 * Creates a scavenge ability
 * @param source - The creature card with scavenge
 * @param scavengeCost - The cost to activate scavenge
 * @param powerToughness - The creature's power/toughness
 * @returns Scavenge ability
 */
export function scavenge(
  source: string,
  scavengeCost: string,
  powerToughness: readonly [number, number]
): ScavengeAbility {
  return {
    type: 'scavenge',
    source,
    scavengeCost,
    powerToughness,
    wasScavenged: false,
  };
}

/**
 * Activates scavenge, exiling the card and adding counters
 * @param ability - The scavenge ability
 * @param target - The target creature
 * @returns Updated scavenge ability
 */
export function activateScavenge(ability: ScavengeAbility, target: string): ScavengeAbility {
  if (ability.wasScavenged) {
    throw new Error('Card has already been scavenged');
  }
  return {
    ...ability,
    wasScavenged: true,
  };
}

/**
 * Gets the number of +1/+1 counters to add
 * @param ability - The scavenge ability
 * @returns Number of counters equal to power
 */
export function getScavengeCounters(ability: ScavengeAbility): number {
  return ability.powerToughness[0];
}
