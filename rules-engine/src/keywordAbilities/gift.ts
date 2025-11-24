/**
 * Gift keyword ability (Rule 702.174)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.174. Gift
 * 702.174a Gift is a keyword that represents two abilities. It is written "Gift a [something]." 
 * The first ability is a static ability that functions while the card with gift is on the stack, 
 * and the second is either an ability that functions while the card with gift is on the stack or 
 * a triggered ability that functions while the card with gift is on the battlefield. The first 
 * ability is always "As an additional cost to cast this spell, you may choose an opponent."
 * 702.174b On a permanent, the second ability represented by gift is "When this permanent enters, 
 * if its gift cost was paid, [effect]." On an instant or sorcery spell, the second ability 
 * represented by gift is "If this spell's gift cost was paid, [effect]."
 * 702.174c Some effects trigger whenever a player gives a gift. Such an ability triggers whenever 
 * an instant or sorcery spell that player controls whose gift cost was paid resolves. It also 
 * triggers whenever the gift triggered ability of a permanent that player controls resolves.
 * 702.174d "Gift a Food" means the effect is "The chosen player creates a Food token."
 */

export interface GiftAbility {
  readonly type: 'gift';
  readonly source: string;
  readonly giftType: string; // What is gifted (e.g., "a Food", "a card")
  readonly chosenOpponent?: string;
  readonly giftGiven: boolean;
}

/**
 * Create a gift ability
 * Rule 702.174a
 * @param source - The spell/permanent with gift
 * @param giftType - What is being gifted
 * @returns Gift ability object
 */
export function gift(source: string, giftType: string): GiftAbility {
  return {
    type: 'gift',
    source,
    giftType,
    giftGiven: false,
  };
}

/**
 * Pay gift cost by choosing an opponent
 * Rule 702.174a - Additional cost: choose an opponent
 * @param ability - Gift ability
 * @param chosenOpponent - ID of chosen opponent
 * @returns Updated ability
 */
export function payGift(ability: GiftAbility, chosenOpponent: string): GiftAbility {
  return {
    ...ability,
    chosenOpponent,
    giftGiven: true,
  };
}

/**
 * Check if gift cost was paid
 * Rule 702.174b
 * @param ability - Gift ability
 * @returns True if gift cost paid
 */
export function wasGiftPaid(ability: GiftAbility): boolean {
  return ability.giftGiven;
}

/**
 * Get chosen opponent
 * @param ability - Gift ability
 * @returns Opponent ID or undefined
 */
export function getGiftRecipient(ability: GiftAbility): string | undefined {
  return ability.chosenOpponent;
}

/**
 * Get gift type
 * @param ability - Gift ability
 * @returns What is being gifted
 */
export function getGiftType(ability: GiftAbility): string {
  return ability.giftType;
}

/**
 * Multiple instances of gift are not redundant
 * @param abilities - Array of gift abilities
 * @returns False
 */
export function hasRedundantGift(abilities: readonly GiftAbility[]): boolean {
  return false;
}
