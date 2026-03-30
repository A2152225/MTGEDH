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
 * Checks whether cycling can be activated from the given zone.
 * Cycling functions only while the card is in hand.
 *
 * @param ability - The cycling ability
 * @param zone - The card's current zone
 * @returns True if cycling can be activated
 */
export function canActivateCycling(ability: CyclingAbility, zone: string): boolean {
  return zone === 'hand';
}

/**
 * Creates the activation summary for cycling.
 *
 * @param ability - The cycling ability
 * @param zone - The card's current zone
 * @returns Activation summary, or null if cycling cannot be activated
 */
export function createCyclingActivationResult(
  ability: CyclingAbility,
  zone: string
): {
  source: string;
  fromZone: 'hand';
  costPaid: string;
  cardsDrawn: 1;
} | null {
  if (!canActivateCycling(ability, zone)) {
    return null;
  }

  return {
    source: ability.source,
    fromZone: 'hand',
    costPaid: ability.cost,
    cardsDrawn: 1,
  };
}

/**
 * Checks whether typecycling can be activated from the given zone.
 *
 * @param ability - The typecycling ability
 * @param zone - The card's current zone
 * @returns True if typecycling can be activated
 */
export function canActivateTypecycling(ability: TypecyclingAbility, zone: string): boolean {
  return zone === 'hand';
}

/**
 * Creates the activation summary for typecycling.
 *
 * @param ability - The typecycling ability
 * @param zone - The card's current zone
 * @returns Activation summary, or null if typecycling cannot be activated
 */
export function createTypecyclingActivationResult(
  ability: TypecyclingAbility,
  zone: string
): {
  source: string;
  fromZone: 'hand';
  costPaid: string;
  searchLandType: string;
} | null {
  if (!canActivateTypecycling(ability, zone)) {
    return null;
  }

  return {
    source: ability.source,
    fromZone: 'hand',
    costPaid: ability.cost,
    searchLandType: ability.landType,
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
