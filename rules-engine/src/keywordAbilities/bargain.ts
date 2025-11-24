/**
 * Bargain keyword ability (Rule 702.166)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.166. Bargain
 * 702.166a Bargain is a static ability that functions while the spell with bargain is on the 
 * stack. "Bargain" means "As an additional cost to cast this spell, you may sacrifice an artifact, 
 * enchantment, or token." Paying a spell's bargain cost follows the rules for paying additional 
 * costs.
 * 702.166b If a spell's controller declares the intention to pay that spell's bargain cost, that 
 * spell has been "bargained."
 * 702.166c Objects with bargain have additional abilities that specify what happens if they were 
 * bargained. These abilities are linked to the bargain ability printed on that object.
 * 702.166d If part of a spell's ability has its effect only if that spell was bargained and that 
 * part of the ability includes any targets, the spell's controller chooses those targets only if 
 * that spell was bargained.
 */

export interface BargainAbility {
  readonly type: 'bargain';
  readonly source: string;
  readonly wasBargained: boolean;
  readonly sacrificedPermanent?: string;
}

/**
 * Create a bargain ability
 * Rule 702.166a
 * @param source - The spell with bargain
 * @returns Bargain ability object
 */
export function bargain(source: string): BargainAbility {
  return {
    type: 'bargain',
    source,
    wasBargained: false,
  };
}

/**
 * Pay bargain cost by sacrificing
 * Rule 702.166a - Sacrifice artifact, enchantment, or token
 * Rule 702.166b - Spell has been "bargained"
 * @param ability - Bargain ability
 * @param sacrificedPermanent - ID of sacrificed permanent
 * @returns Updated ability
 */
export function payBargain(ability: BargainAbility, sacrificedPermanent: string): BargainAbility {
  return {
    ...ability,
    wasBargained: true,
    sacrificedPermanent,
  };
}

/**
 * Check if spell was bargained
 * Rule 702.166b
 * @param ability - Bargain ability
 * @returns True if bargained
 */
export function wasBargained(ability: BargainAbility): boolean {
  return ability.wasBargained;
}

/**
 * Get sacrificed permanent
 * @param ability - Bargain ability
 * @returns ID of sacrificed permanent or undefined
 */
export function getBargainedPermanent(ability: BargainAbility): string | undefined {
  return ability.sacrificedPermanent;
}

/**
 * Multiple instances of bargain are not redundant
 * @param abilities - Array of bargain abilities
 * @returns False
 */
export function hasRedundantBargain(abilities: readonly BargainAbility[]): boolean {
  return false;
}
