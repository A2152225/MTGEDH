/**
 * Delve keyword ability (Rule 702.66)
 * 
 * @module keywordAbilities/delve
 */

/**
 * Represents a delve ability on a spell.
 * Rule 702.66: Delve is a static ability that functions while the spell with delve 
 * is on the stack. "Delve" means "For each generic mana in this spell's total cost, 
 * you may exile a card from your graveyard rather than pay that mana."
 */
export interface DelveAbility {
  readonly type: 'delve';
  readonly source: string;
  readonly cardsExiled: number;
}

/**
 * Creates a delve ability.
 * 
 * @param source - The source spell with delve
 * @returns A delve ability
 * 
 * @example
 * ```typescript
 * const ability = delve('Treasure Cruise');
 * ```
 */
export function delve(source: string): DelveAbility {
  return {
    type: 'delve',
    source,
    cardsExiled: 0
  };
}

/**
 * Exiles a card from graveyard for delve.
 * 
 * @param ability - The delve ability
 * @returns Updated ability
 */
export function exileForDelve(ability: DelveAbility): DelveAbility {
  return {
    ...ability,
    cardsExiled: ability.cardsExiled + 1
  };
}

/**
 * Calculates cost reduction from delve.
 * 
 * @param ability - The delve ability
 * @returns Amount of generic mana reduced
 */
export function getDelveCostReduction(ability: DelveAbility): number {
  return ability.cardsExiled;
}

/**
 * Gets the maximum generic mana reduction delve can provide.
 * Delve can only reduce the generic portion of a spell's cost.
 *
 * @param genericManaCost - The spell's remaining generic mana cost
 * @param cardsAvailableToExile - The number of graveyard cards available to exile
 * @returns The maximum generic mana that delve can reduce
 */
export function getMaximumDelveReduction(
  genericManaCost: number,
  cardsAvailableToExile: number
): number {
  return Math.max(0, Math.min(genericManaCost, cardsAvailableToExile));
}

/**
 * Creates the result of applying delve to a spell's generic mana cost.
 *
 * @param ability - The delve ability
 * @param genericManaCost - The spell's generic mana cost before delve is applied
 * @returns Payment summary with capped generic reduction
 */
export function createDelvePaymentResult(
  ability: DelveAbility,
  genericManaCost: number
): {
  source: string;
  cardsExiled: number;
  genericReducedBy: number;
  genericManaRemaining: number;
} {
  const genericReducedBy = getMaximumDelveReduction(genericManaCost, ability.cardsExiled);
  return {
    source: ability.source,
    cardsExiled: ability.cardsExiled,
    genericReducedBy,
    genericManaRemaining: Math.max(0, genericManaCost - genericReducedBy),
  };
}
