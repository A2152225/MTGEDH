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
 * Checks if spell returns to hand instead of graveyard after resolution
 * Rule 702.27a - If buyback was paid, spell goes to hand instead of graveyard
 * 
 * @param ability - The buyback ability
 * @returns True if buyback was paid and spell should return to hand
 */
export function shouldBuybackReturnToHand(ability: BuybackAbility): boolean {
  return ability.wasPaid;
}

/**
 * Checks whether a spell can be cast using buyback.
 * Buyback is an additional cost that matters while casting from hand.
 *
 * @param ability - The buyback ability
 * @param zone - The card's current zone
 * @returns True if buyback can be used
 */
export function canCastWithBuyback(ability: BuybackAbility, zone: string): boolean {
  return zone === 'hand';
}

/**
 * Creates the cast summary for a spell cast with buyback.
 *
 * @param ability - The buyback ability
 * @param zone - The card's current zone
 * @returns Cast summary, or null if buyback cannot be used
 */
export function createBuybackCastResult(
  ability: BuybackAbility,
  zone: string
): {
  source: string;
  fromZone: 'hand';
  additionalCostPaid: string;
  usedBuyback: true;
} | null {
  if (!ability.wasPaid || !canCastWithBuyback(ability, zone)) {
    return null;
  }

  return {
    source: ability.source,
    fromZone: 'hand',
    additionalCostPaid: ability.cost,
    usedBuyback: true,
  };
}

/**
 * Creates the resolution summary for a buyback spell.
 *
 * @param ability - The buyback ability
 * @returns Resolution summary including final zone
 */
export function createBuybackResolutionResult(ability: BuybackAbility): {
  source: string;
  destination: 'hand' | 'graveyard';
} {
  return {
    source: ability.source,
    destination: shouldBuybackReturnToHand(ability) ? 'hand' : 'graveyard',
  };
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
