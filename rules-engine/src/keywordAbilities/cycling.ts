/**
 * Cycling keyword ability implementation
 * Rule 702.29
 * 
 * Cycling is an activated ability that functions only while the card with cycling is in a player's hand.
 */

/**
 * Cycling ability
 * Rule 702.29a
 * 
 * "Cycling [cost]" means "[Cost], Discard this card: Draw a card."
 */
export interface CyclingAbility {
  readonly type: 'cycling';
  readonly cost: string;
  readonly source: string;
}

/**
 * Creates a cycling ability
 * Rule 702.29a
 * 
 * @param source - The card with cycling
 * @param cost - The cycling cost
 * @returns Cycling ability
 */
export function cycling(source: string, cost: string): CyclingAbility {
  return {
    type: 'cycling',
    cost,
    source,
  };
}

/**
 * Typecycling variant
 * Rule 702.29b
 * 
 * Some cards have variants like "Plainscycling", "Islandcycling", etc.
 * These allow searching for a specific basic land type instead of just drawing.
 */
export interface TypecyclingAbility {
  readonly type: 'typecycling';
  readonly cost: string;
  readonly landType: string; // e.g., "Plains", "Island", "Mountain"
  readonly source: string;
}

/**
 * Creates a typecycling ability
 * Rule 702.29b
 * 
 * @param source - The card with typecycling
 * @param cost - The typecycling cost
 * @param landType - The basic land type to search for
 * @returns Typecycling ability
 */
export function typecycling(source: string, cost: string, landType: string): TypecyclingAbility {
  return {
    type: 'typecycling',
    cost,
    landType,
    source,
  };
}

/**
 * Checks if multiple cycling abilities are cumulative
 * Rule 702.29c - Multiple instances of cycling are cumulative (different abilities)
 * 
 * @param abilities - Array of cycling abilities
 * @returns False (each is a separate activated ability)
 */
export function hasRedundantCycling(abilities: readonly CyclingAbility[]): boolean {
  return false; // Each cycling ability is separate
}
