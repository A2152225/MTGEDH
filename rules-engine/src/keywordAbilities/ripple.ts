/**
 * Ripple keyword ability (Rule 702.60)
 * 
 * @module keywordAbilities/ripple
 */

/**
 * Represents a ripple ability on a spell.
 * Rule 702.60: Ripple is a triggered ability that functions only while the card with 
 * ripple is on the stack. "Ripple N" means "When you cast this spell, you may reveal 
 * the top N cards of your library, or, if there are fewer than N cards in your library, 
 * you may reveal all the cards in your library. If you reveal cards from your library 
 * this way, you may cast any of those cards with the same name as this spell without 
 * paying their mana costs, then put all revealed cards not cast this way on the bottom 
 * of your library in any order."
 */
export interface RippleAbility {
  readonly type: 'ripple';
  readonly count: number;
  readonly source: string;
}

/**
 * Creates a ripple ability.
 * 
 * @param source - The source spell with ripple
 * @param count - Number of cards to reveal (ripple N)
 * @returns A ripple ability
 * 
 * @example
 * ```typescript
 * const ability = ripple('Surging Flame', 4);
 * ```
 */
export function ripple(source: string, count: number): RippleAbility {
  return {
    type: 'ripple',
    count,
    source
  };
}

/**
 * Gets the actual number of cards to reveal.
 * 
 * @param ability - The ripple ability
 * @param librarySize - Current library size
 * @returns Number of cards to reveal
 */
export function getRippleRevealCount(ability: RippleAbility, librarySize: number): number {
  return Math.min(ability.count, librarySize);
}
