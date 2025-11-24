/**
 * More Than Meets the Eye keyword ability (Rule 702.162)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.162. More Than Meets the Eye
 * 702.162a More Than Meets the Eye represents a static ability that functions in any zone from 
 * which the spell may be cast. "More Than Meets the Eye [cost]" means "You may cast this card 
 * converted by paying [cost] rather than its mana cost." Casting a spell using its More Than 
 * Meets the Eye ability follows the rules for paying alternative costs. See rule 701.28, "Convert."
 */

export interface MoreThanMeetsTheEyeAbility {
  readonly type: 'more-than-meets-the-eye';
  readonly source: string;
  readonly mtmteCost: string;
  readonly wasConverted: boolean;
}

/**
 * Create a More Than Meets the Eye ability
 * Rule 702.162a
 * @param source - The card with MTMTE
 * @param mtmteCost - Alternative cost to cast converted
 * @returns More Than Meets the Eye ability object
 */
export function moreThanMeetsTheEye(source: string, mtmteCost: string): MoreThanMeetsTheEyeAbility {
  return {
    type: 'more-than-meets-the-eye',
    source,
    mtmteCost,
    wasConverted: false,
  };
}

/**
 * Cast card converted using More Than Meets the Eye
 * Rule 702.162a - Alternative cost, converts the card
 * @param ability - More Than Meets the Eye ability
 * @returns Updated ability
 */
export function castConverted(ability: MoreThanMeetsTheEyeAbility): MoreThanMeetsTheEyeAbility {
  return {
    ...ability,
    wasConverted: true,
  };
}

/**
 * Check if spell was converted
 * @param ability - More Than Meets the Eye ability
 * @returns True if converted
 */
export function wasConverted(ability: MoreThanMeetsTheEyeAbility): boolean {
  return ability.wasConverted;
}

/**
 * Get More Than Meets the Eye cost
 * @param ability - More Than Meets the Eye ability
 * @returns MTMTE cost string
 */
export function getMTMTECost(ability: MoreThanMeetsTheEyeAbility): string {
  return ability.mtmteCost;
}

/**
 * Multiple instances of More Than Meets the Eye are not redundant
 * @param abilities - Array of MTMTE abilities
 * @returns False
 */
export function hasRedundantMoreThanMeetsTheEye(abilities: readonly MoreThanMeetsTheEyeAbility[]): boolean {
  return false;
}
