/**
 * Morph keyword ability implementation
 * Rule 702.37
 * 
 * Morph is a static ability that functions in any zone from which you could play the card it's on.
 */

/**
 * Morph ability
 * Rule 702.37a
 * 
 * "Morph [cost]" means "You may cast this card as a 2/2 face-down creature with no text,
 * no name, no subtypes, and no mana cost by paying {3} rather than paying its mana cost."
 */
export interface MorphAbility {
  readonly type: 'morph';
  readonly cost: string;
  readonly source: string;
  readonly isFaceDown: boolean;
}

/**
 * Creates a morph ability
 * Rule 702.37a
 * 
 * @param source - The card with morph
 * @param cost - The morph cost
 * @returns Morph ability
 */
export function morph(source: string, cost: string): MorphAbility {
  return {
    type: 'morph',
    cost,
    source,
    isFaceDown: false,
  };
}

/**
 * Casts spell face down with morph
 * Rule 702.37a - Pay {3} instead of mana cost to cast as 2/2 face-down creature
 * 
 * @param ability - The morph ability
 * @returns Updated ability in face-down state
 */
export function morphCastFaceDown(ability: MorphAbility): MorphAbility {
  return {
    ...ability,
    isFaceDown: true,
  };
}

/**
 * Turns a face-down morphed permanent face up
 * Rule 702.37b - Pay morph cost to turn face up at any time you have priority
 * 
 * @param ability - The morph ability
 * @returns Updated ability in face-up state
 */
export function morphTurnFaceUp(ability: MorphAbility): MorphAbility {
  return {
    ...ability,
    isFaceDown: false,
  };
}

/**
 * Checks whether a card can be cast face down with morph.
 * Morph works from zones the card could normally be cast from, typically hand.
 *
 * @param ability - The morph ability
 * @param zone - The card's current zone
 * @returns True if the card can be cast face down
 */
export function canCastMorphFaceDown(ability: MorphAbility, zone: string): boolean {
  return zone === 'hand';
}

/**
 * Creates the cast summary for a face-down morph spell.
 *
 * @param ability - The morph ability
 * @param zone - The card's current zone
 * @returns Cast summary, or null if morph cannot be used
 */
export function createMorphCastResult(
  ability: MorphAbility,
  zone: string
): {
  source: string;
  fromZone: 'hand';
  castFaceDown: true;
  alternativeCostPaid: '{3}';
} | null {
  if (!canCastMorphFaceDown(ability, zone)) {
    return null;
  }

  return {
    source: ability.source,
    fromZone: 'hand',
    castFaceDown: true,
    alternativeCostPaid: '{3}',
  };
}

/**
 * Creates the turn-face-up summary for morph.
 *
 * @param ability - The morph ability
 * @returns Turn-face-up summary, or null if the permanent is already face up
 */
export function createMorphTurnFaceUpResult(
  ability: MorphAbility
): {
  source: string;
  costPaid: string;
  turnedFaceUp: true;
} | null {
  if (!ability.isFaceDown) {
    return null;
  }

  return {
    source: ability.source,
    costPaid: ability.cost,
    turnedFaceUp: true,
  };
}

/**
 * Gets face-down creature stats
 * Rule 702.37c
 * 
 * @returns Power and toughness of face-down creature
 */
export function getFaceDownStats(): { power: number; toughness: number } {
  return { power: 2, toughness: 2 };
}

/**
 * Megamorph variant
 * Rule 702.37d
 * 
 * "Megamorph [cost]" means the same as "Morph [cost]" except that if you turn
 * the permanent face up using megamorph, put a +1/+1 counter on it.
 */
export interface MegamorphAbility {
  readonly type: 'megamorph';
  readonly cost: string;
  readonly source: string;
  readonly isFaceDown: boolean;
}

/**
 * Creates a megamorph ability
 * Rule 702.37d
 * 
 * @param source - The card with megamorph
 * @param cost - The megamorph cost
 * @returns Megamorph ability
 */
export function megamorph(source: string, cost: string): MegamorphAbility {
  return {
    type: 'megamorph',
    cost,
    source,
    isFaceDown: false,
  };
}

/**
 * Creates the turn-face-up summary for megamorph.
 *
 * @param ability - The megamorph ability
 * @returns Turn-face-up summary, or null if the permanent is already face up
 */
export function createMegamorphTurnFaceUpResult(
  ability: MegamorphAbility
): {
  source: string;
  costPaid: string;
  turnedFaceUp: true;
  plusOnePlusOneCountersAdded: 1;
} | null {
  if (!ability.isFaceDown) {
    return null;
  }

  return {
    source: ability.source,
    costPaid: ability.cost,
    turnedFaceUp: true,
    plusOnePlusOneCountersAdded: 1,
  };
}

/**
 * Checks if multiple morph abilities are redundant
 * Rule 702.37e - Multiple instances of morph/megamorph are redundant
 * 
 * @param abilities - Array of morph abilities
 * @returns True if more than one morph
 */
export function hasRedundantMorph(abilities: readonly (MorphAbility | MegamorphAbility)[]): boolean {
  return abilities.length > 1;
}
