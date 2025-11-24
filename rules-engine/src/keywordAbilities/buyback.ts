/**
 * Buyback keyword ability implementation
 * Rule 702.27
 * 
 * Buyback is a static ability that functions while the spell with buyback is on the stack.
 */

/**
 * Buyback ability
 * Rule 702.27a
 * 
 * "Buyback [cost]" means "You may pay an additional [cost] as you cast this spell.
 * If the buyback cost was paid, put this spell into its owner's hand instead of into
 * that player's graveyard as it resolves."
 */
export interface BuybackAbility {
  readonly type: 'buyback';
  readonly cost: string;
  readonly source: string;
  readonly wasPaid: boolean;
}

/**
 * Creates a buyback ability
 * Rule 702.27a
 * 
 * @param source - The spell with buyback
 * @param cost - The buyback cost
 * @returns Buyback ability
 */
export function buyback(source: string, cost: string): BuybackAbility {
  return {
    type: 'buyback',
    cost,
    source,
    wasPaid: false,
  };
}

/**
 * Pays the buyback cost
 * Rule 702.27a
 * 
 * @param ability - The buyback ability
 * @returns Updated ability with paid status
 */
export function payBuyback(ability: BuybackAbility): BuybackAbility {
  return {
    ...ability,
    wasPaid: true,
  };
}

/**
 * Checks if spell returns to hand instead of graveyard
 * Rule 702.27a
 * 
 * @param ability - The buyback ability
 * @returns True if buyback was paid
 */
export function shouldReturnToHand(ability: BuybackAbility): boolean {
  return ability.wasPaid;
}

/**
 * Checks if multiple buyback abilities are redundant
 * Rule 702.27b - Multiple instances of buyback are redundant
 * 
 * @param abilities - Array of buyback abilities
 * @returns True if more than one buyback
 */
export function hasRedundantBuyback(abilities: readonly BuybackAbility[]): boolean {
  return abilities.length > 1;
}
