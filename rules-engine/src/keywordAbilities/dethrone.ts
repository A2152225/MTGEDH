/**
 * Dethrone keyword ability implementation (Rule 702.105)
 * 
 * From MTG Comprehensive Rules (Nov 2025):
 * 702.105a Dethrone is a triggered ability. "Dethrone" means "Whenever this creature
 * attacks the player with the most life or tied for the most life, put a +1/+1 counter
 * on this creature."
 * 
 * 702.105b If a creature has multiple instances of dethrone, each triggers separately.
 */

/**
 * Dethrone ability interface
 */
export interface DethroneAbility {
  readonly type: 'dethrone';
  readonly source: string;
  readonly countersPut: number;
}

export interface DethroneResolution {
  readonly source: string;
  readonly triggered: boolean;
  readonly countersPut: number;
}

/**
 * Creates a dethrone ability
 * @param source - Source creature with dethrone
 * @returns Dethrone ability
 */
export function dethrone(source: string): DethroneAbility {
  return {
    type: 'dethrone',
    source,
    countersPut: 0,
  };
}

/**
 * Checks if attacking player with most/tied for most life
 * @param defendingPlayerLife - Life total of defending player
 * @param allPlayerLives - Life totals of all players
 * @returns True if dethrone triggers
 */
export function shouldTriggerDethrone(
  defendingPlayerLife: number,
  allPlayerLives: readonly number[]
): boolean {
  const maxLife = Math.max(...allPlayerLives);
  return defendingPlayerLife === maxLife;
}

/**
 * Triggers dethrone, adding a +1/+1 counter
 * @param ability - Dethrone ability
 * @returns Updated dethrone ability with counter
 */
export function triggerDethrone(ability: DethroneAbility): DethroneAbility {
  return {
    ...ability,
    countersPut: ability.countersPut + 1,
  };
}

/**
 * Gets total counters put by dethrone
 * @param ability - Dethrone ability
 * @returns Counter count
 */
export function getDethroneCounters(ability: DethroneAbility): number {
  return ability.countersPut;
}

export function getHighestLifeTotal(allPlayerLives: readonly number[]): number {
  return Math.max(...allPlayerLives);
}

export function getEligibleDethroneLifeTotals(allPlayerLives: readonly number[]): number[] {
  const highestLife = getHighestLifeTotal(allPlayerLives);
  return allPlayerLives.filter(lifeTotal => lifeTotal === highestLife);
}

export function createDethroneResolution(
  ability: DethroneAbility,
  triggered: boolean
): DethroneResolution {
  return {
    source: ability.source,
    triggered,
    countersPut: triggered ? ability.countersPut + 1 : ability.countersPut,
  };
}
