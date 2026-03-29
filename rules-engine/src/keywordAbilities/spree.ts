/**
 * Spree keyword ability (Rule 702.172)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.172. Spree
 * 702.172a Spree is a static ability found on some modal spells that applies while the spell is 
 * on the stack. Spree means "Choose one or more modes. As an additional cost to cast this spell, 
 * pay the costs associated with those modes."
 * 702.172b Cards with the spree ability have a plus sign icon in the upper right corner of the 
 * card, and use a plus sign (+) rather than traditional bullet points.
 */

export interface SpreeAbility {
  readonly type: 'spree';
  readonly source: string;
  readonly chosenModes: readonly number[];
  readonly modeCosts: readonly string[];
}

function uniqueNumericModes(modes: readonly number[]): number[] {
  return [...new Set(modes.filter((mode) => Number.isInteger(mode)))];
}

/**
 * Create a spree ability
 * Rule 702.172a
 * @param source - The modal spell with spree
 * @param modeCosts - Costs for each mode
 * @returns Spree ability object
 */
export function spree(source: string, modeCosts: readonly string[]): SpreeAbility {
  return {
    type: 'spree',
    source,
    chosenModes: [],
    modeCosts,
  };
}

/**
 * Choose modes for spree
 * Rule 702.172a - Choose one or more, pay associated costs
 * @param ability - Spree ability
 * @param chosenModes - Indices of chosen modes
 * @returns Updated ability
 */
export function chooseSpreeModes(ability: SpreeAbility, chosenModes: readonly number[]): SpreeAbility {
  return {
    ...ability,
    chosenModes: uniqueNumericModes(chosenModes),
  };
}

/**
 * Check whether a spree mode selection is valid.
 * Rule 702.172a
 */
export function canChooseSpreeModes(ability: SpreeAbility, chosenModes: readonly number[]): boolean {
  const uniqueModes = uniqueNumericModes(chosenModes);
  return uniqueModes.length > 0 && uniqueModes.every((mode) => mode >= 0 && mode < ability.modeCosts.length);
}

/**
 * Get chosen modes
 * @param ability - Spree ability
 * @returns Array of chosen mode indices
 */
export function getChosenModes(ability: SpreeAbility): readonly number[] {
  return ability.chosenModes;
}

/**
 * Get total cost for chosen modes
 * @param ability - Spree ability
 * @returns Array of costs for chosen modes
 */
export function getSpreeCosts(ability: SpreeAbility): readonly string[] {
  return ability.chosenModes.map(index => ability.modeCosts[index]);
}

/**
 * Get the number of selected spree modes.
 */
export function getSpreeModeCount(ability: SpreeAbility): number {
  return ability.chosenModes.length;
}

/**
 * Multiple instances of spree are redundant
 * @param abilities - Array of spree abilities
 * @returns True if more than one
 */
export function hasRedundantSpree(abilities: readonly SpreeAbility[]): boolean {
  return abilities.length > 1;
}
