/**
 * Melee keyword ability (Rule 702.121)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.121. Melee
 * 702.121a Melee is a triggered ability. "Melee" means "Whenever this creature attacks, it 
 * gets +1/+1 until end of turn for each opponent you attacked with a creature this combat."
 * 702.121b If a creature has multiple instances of melee, each triggers separately.
 */

export interface MeleeAbility {
  readonly type: 'melee';
  readonly source: string;
  readonly bonusThisTurn: number;
}

/**
 * Create a melee ability
 * Rule 702.121a
 * @param source - The creature with melee
 * @returns Melee ability object
 */
export function melee(source: string): MeleeAbility {
  return {
    type: 'melee',
    source,
    bonusThisTurn: 0,
  };
}

/**
 * Trigger melee when creature attacks
 * Rule 702.121a - Gets +1/+1 for each opponent attacked
 * @param ability - Melee ability
 * @param opponentsAttacked - Number of opponents attacked this combat
 * @returns Updated ability with bonus
 */
export function triggerMelee(ability: MeleeAbility, opponentsAttacked: number): MeleeAbility {
  return {
    ...ability,
    bonusThisTurn: ability.bonusThisTurn + opponentsAttacked,
  };
}

/**
 * Get melee bonus
 * Rule 702.121a - +1/+1 for each opponent attacked
 * @param ability - Melee ability
 * @returns Bonus this turn
 */
export function getMeleeBonus(ability: MeleeAbility): number {
  return ability.bonusThisTurn;
}

/**
 * Clear melee bonus at end of turn
 * @param ability - Melee ability
 * @returns Ability with bonus cleared
 */
export function clearMeleeBonus(ability: MeleeAbility): MeleeAbility {
  return {
    ...ability,
    bonusThisTurn: 0,
  };
}

/**
 * Multiple instances of melee trigger separately
 * Rule 702.121b
 * @param abilities - Array of melee abilities
 * @returns False - each instance triggers separately
 */
export function hasRedundantMelee(abilities: readonly MeleeAbility[]): boolean {
  return false; // Each instance triggers separately
}
