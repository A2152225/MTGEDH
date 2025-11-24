/**
 * Mayhem keyword ability (Rule 702.187)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.187. Mayhem
 * 702.187a Mayhem is a static ability that functions while the card with mayhem is in a player's 
 * graveyard.
 * 702.187b "Mayhem [cost]" means "As long as you discarded this card this turn, you may cast it 
 * from your graveyard by paying [cost] rather than paying its mana cost."
 * 702.187c "Mayhem" without a cost means "You may play this card from your graveyard if you 
 * discarded it this turn."
 */

export interface MayhemAbility {
  readonly type: 'mayhem';
  readonly source: string;
  readonly mayhemCost?: string;
  readonly wasDiscardedThisTurn: boolean;
  readonly wasCastWithMayhem: boolean;
}

/**
 * Create a mayhem ability
 * Rule 702.187a
 * @param source - The card with mayhem
 * @param mayhemCost - Alternative cost (optional)
 * @returns Mayhem ability object
 */
export function mayhem(source: string, mayhemCost?: string): MayhemAbility {
  return {
    type: 'mayhem',
    source,
    mayhemCost,
    wasDiscardedThisTurn: false,
    wasCastWithMayhem: false,
  };
}

/**
 * Mark card as discarded this turn
 * @param ability - Mayhem ability
 * @returns Updated ability
 */
export function discardForMayhem(ability: MayhemAbility): MayhemAbility {
  return {
    ...ability,
    wasDiscardedThisTurn: true,
  };
}

/**
 * Cast from graveyard with mayhem
 * Rule 702.187b/c
 * @param ability - Mayhem ability
 * @returns Updated ability or null if not discarded this turn
 */
export function castWithMayhem(ability: MayhemAbility): MayhemAbility | null {
  if (!ability.wasDiscardedThisTurn) {
    return null;
  }
  
  return {
    ...ability,
    wasCastWithMayhem: true,
  };
}

/**
 * Check if can cast with mayhem
 * Rule 702.187b/c
 * @param ability - Mayhem ability
 * @returns True if can cast
 */
export function canCastWithMayhem(ability: MayhemAbility): boolean {
  return ability.wasDiscardedThisTurn;
}

/**
 * Reset mayhem at end of turn
 * @param ability - Mayhem ability
 * @returns Ability with discard reset
 */
export function resetMayhem(ability: MayhemAbility): MayhemAbility {
  return {
    ...ability,
    wasDiscardedThisTurn: false,
  };
}

/**
 * Multiple instances of mayhem are not redundant
 * @param abilities - Array of mayhem abilities
 * @returns False
 */
export function hasRedundantMayhem(abilities: readonly MayhemAbility[]): boolean {
  return false;
}
