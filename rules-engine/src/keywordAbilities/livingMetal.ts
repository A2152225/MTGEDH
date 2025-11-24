/**
 * Living Metal keyword ability (Rule 702.161)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.161. Living Metal
 * 702.161a Living metal is a keyword ability found on some Vehicles. "Living metal" means 
 * "During your turn, this permanent is an artifact creature in addition to its other types."
 */

export interface LivingMetalAbility {
  readonly type: 'living-metal';
  readonly source: string;
  readonly isYourTurn: boolean;
}

/**
 * Create a living metal ability
 * Rule 702.161a
 * @param source - The Vehicle with living metal
 * @returns Living metal ability object
 */
export function livingMetal(source: string): LivingMetalAbility {
  return {
    type: 'living-metal',
    source,
    isYourTurn: false,
  };
}

/**
 * Update turn state for living metal
 * Rule 702.161a - Is creature during your turn
 * @param ability - Living metal ability
 * @param isYourTurn - Whether it's your turn
 * @returns Updated ability
 */
export function updateLivingMetalTurn(ability: LivingMetalAbility, isYourTurn: boolean): LivingMetalAbility {
  return {
    ...ability,
    isYourTurn,
  };
}

/**
 * Check if Vehicle is a creature due to living metal
 * Rule 702.161a
 * @param ability - Living metal ability
 * @returns True if is creature (during your turn)
 */
export function isCreatureFromLivingMetal(ability: LivingMetalAbility): boolean {
  return ability.isYourTurn;
}

/**
 * Multiple instances of living metal are redundant
 * @param abilities - Array of living metal abilities
 * @returns True if more than one
 */
export function hasRedundantLivingMetal(abilities: readonly LivingMetalAbility[]): boolean {
  return abilities.length > 1;
}
