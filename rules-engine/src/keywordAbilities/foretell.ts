/**
 * Foretell keyword ability (Rule 702.143)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.143. Foretell
 * 702.143a Foretell is a keyword that functions while the card with foretell is in a player's 
 * hand. Any time a player has priority during their turn, that player may pay {2} and exile a 
 * card with foretell from their hand face down. That player may look at that card as long as it 
 * remains in exile. They may cast that card after the current turn has ended by paying any 
 * foretell cost it has rather than paying that spell's mana cost.
 * 702.143b Exiling a card using its foretell ability is a special action, which doesn't use the 
 * stack.
 * 702.143c If an effect refers to foretelling a card, it means performing the special action 
 * associated with a foretell ability. If an effect refers to a card or spell that was foretold, 
 * it means a card put in the exile zone as a result of the special action associated with a 
 * foretell ability.
 */

export interface ForetellAbility {
  readonly type: 'foretell';
  readonly source: string;
  readonly foretellCost?: string;
  readonly isForetold: boolean;
  readonly turnForetold?: number;
}

/**
 * Create a foretell ability
 * Rule 702.143a
 * @param source - The card with foretell
 * @param foretellCost - Optional alternative cost to cast foretold card
 * @returns Foretell ability object
 */
export function foretell(source: string, foretellCost?: string): ForetellAbility {
  return {
    type: 'foretell',
    source,
    foretellCost,
    isForetold: false,
  };
}

/**
 * Foretell a card (special action)
 * Rule 702.143a - Pay {2}, exile face down
 * Rule 702.143b - Special action, doesn't use stack
 * @param ability - Foretell ability
 * @param currentTurn - Current turn number
 * @returns Updated ability
 */
export function foretellCard(ability: ForetellAbility, currentTurn: number): ForetellAbility {
  return {
    ...ability,
    isForetold: true,
    turnForetold: currentTurn,
  };
}

/**
 * Check if can cast foretold card
 * Rule 702.143a - Can cast after turn it was foretold
 * @param ability - Foretell ability
 * @param currentTurn - Current turn number
 * @returns True if can cast
 */
export function canCastForetold(ability: ForetellAbility, currentTurn: number): boolean {
  if (!ability.isForetold || !ability.turnForetold) {
    return false;
  }
  return currentTurn > ability.turnForetold;
}

/**
 * Cast foretold card
 * Rule 702.143a - Pay foretell cost instead of mana cost
 * @param ability - Foretell ability
 * @returns Updated ability
 */
export function castForetold(ability: ForetellAbility): ForetellAbility {
  return {
    ...ability,
    isForetold: false,
  };
}

/**
 * Check if card was foretold
 * Rule 702.143c
 * @param ability - Foretell ability
 * @returns True if foretold
 */
export function wasForetold(ability: ForetellAbility): boolean {
  return ability.isForetold;
}

/**
 * Get foretell cost
 * @param ability - Foretell ability
 * @returns Foretell cost or undefined
 */
export function getForetellCost(ability: ForetellAbility): string | undefined {
  return ability.foretellCost;
}

/**
 * Multiple instances of foretell are not redundant
 * @param abilities - Array of foretell abilities
 * @returns False
 */
export function hasRedundantForetell(abilities: readonly ForetellAbility[]): boolean {
  return false;
}
