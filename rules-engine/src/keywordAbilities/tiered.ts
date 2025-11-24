/**
 * Tiered keyword ability (Rule 702.183)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.183. Tiered
 * 702.183a Tiered is a static ability found on some modal spells that applies while the spell is 
 * on the stack. Tiered means "Choose one. As an additional cost to cast this spell, pay the cost 
 * associated with that mode."
 */

export interface TieredAbility {
  readonly type: 'tiered';
  readonly source: string;
  readonly chosenMode?: number;
  readonly modeCosts: readonly string[];
}

/**
 * Create a tiered ability
 * Rule 702.183a
 * @param source - The modal spell with tiered
 * @param modeCosts - Costs for each mode
 * @returns Tiered ability object
 */
export function tiered(source: string, modeCosts: readonly string[]): TieredAbility {
  return {
    type: 'tiered',
    source,
    modeCosts,
  };
}

/**
 * Choose mode for tiered
 * Rule 702.183a - Choose one, pay associated cost
 * @param ability - Tiered ability
 * @param chosenMode - Index of chosen mode
 * @returns Updated ability
 */
export function chooseTieredMode(ability: TieredAbility, chosenMode: number): TieredAbility {
  return {
    ...ability,
    chosenMode,
  };
}

/**
 * Get chosen mode
 * @param ability - Tiered ability
 * @returns Chosen mode index or undefined
 */
export function getChosenTieredMode(ability: TieredAbility): number | undefined {
  return ability.chosenMode;
}

/**
 * Get cost for chosen mode
 * @param ability - Tiered ability
 * @returns Cost string or undefined
 */
export function getTieredCost(ability: TieredAbility): string | undefined {
  if (ability.chosenMode !== undefined) {
    return ability.modeCosts[ability.chosenMode];
  }
  return undefined;
}

/**
 * Multiple instances of tiered are redundant
 * @param abilities - Array of tiered abilities
 * @returns True if more than one
 */
export function hasRedundantTiered(abilities: readonly TieredAbility[]): boolean {
  return abilities.length > 1;
}
