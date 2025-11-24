/**
 * Evolve keyword ability implementation (Rule 702.100)
 * 
 * From MTG Comprehensive Rules (Nov 2025):
 * 702.100a Evolve is a triggered ability. "Evolve" means "Whenever a creature
 * enters the battlefield under your control, if that creature's power is greater
 * than this creature's power and/or that creature's toughness is greater than
 * this creature's toughness, put a +1/+1 counter on this creature."
 * 
 * 702.100b If a creature has multiple instances of evolve, each triggers separately.
 */

/**
 * Evolve ability interface
 */
export interface EvolveAbility {
  readonly type: 'evolve';
  readonly source: string;
  readonly powerToughness: readonly [number, number];
  readonly evolutionCount: number;
}

/**
 * Creates an evolve ability
 * @param source - Source permanent with evolve
 * @param powerToughness - Current power and toughness
 * @returns Evolve ability
 */
export function evolve(
  source: string,
  powerToughness: readonly [number, number]
): EvolveAbility {
  return {
    type: 'evolve',
    source,
    powerToughness,
    evolutionCount: 0,
  };
}

/**
 * Checks if a creature triggers evolve
 * @param ability - Evolve ability
 * @param incomingPT - Power/toughness of entering creature
 * @returns True if evolve triggers
 */
export function shouldTriggerEvolve(
  ability: EvolveAbility,
  incomingPT: readonly [number, number]
): boolean {
  const [currentPower, currentToughness] = ability.powerToughness;
  const [incomingPower, incomingToughness] = incomingPT;
  
  return incomingPower > currentPower || incomingToughness > currentToughness;
}

/**
 * Triggers evolve, adding a +1/+1 counter
 * @param ability - Evolve ability
 * @param newPT - New power/toughness after counter
 * @returns Updated evolve ability
 */
export function triggerEvolve(
  ability: EvolveAbility,
  newPT: readonly [number, number]
): EvolveAbility {
  return {
    ...ability,
    powerToughness: newPT,
    evolutionCount: ability.evolutionCount + 1,
  };
}

/**
 * Gets the number of times evolve has triggered
 * @param ability - Evolve ability
 * @returns Evolution count
 */
export function getEvolutionCount(ability: EvolveAbility): number {
  return ability.evolutionCount;
}
