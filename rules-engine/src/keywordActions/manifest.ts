/**
 * Rule 701.40: Manifest
 * 
 * To manifest a card, turn it face down. It becomes a 2/2 face-down creature
 * card with no text, no name, no subtypes, and no mana cost. Put that card onto
 * the battlefield face down.
 * 
 * Reference: Rule 701.40, also see Rule 708 "Face-Down Spells and Permanents"
 */

export interface ManifestAction {
  readonly type: 'manifest';
  readonly playerId: string;
  readonly cardIds: readonly string[]; // Cards to manifest
  readonly fromZone: string;
}

export interface ManifestedPermanent {
  readonly permanentId: string;
  readonly originalCardId: string;
  readonly isFaceDown: boolean;
  readonly canTurnFaceUp: boolean;
  readonly manaCost?: string; // For turning face up
}

/**
 * Rule 701.40a: Manifest a card
 * 
 * To manifest a card, turn it face down. It becomes a 2/2 face-down creature
 * card with no text, no name, no subtypes, and no mana cost. Put that card onto
 * the battlefield face down.
 */
export function manifest(
  playerId: string,
  cardIds: readonly string[],
  fromZone: string = 'library'
): ManifestAction {
  return {
    type: 'manifest',
    playerId,
    cardIds,
    fromZone,
  };
}

/**
 * Manifest characteristics (Rule 701.40a)
 */
export const MANIFESTED_CHARACTERISTICS = {
  power: 2,
  toughness: 2,
  types: ['Creature'],
  subtypes: [],
  name: '',
  text: '',
  manaCost: undefined,
  colors: [],
} as const;

/**
 * Rule 701.40b: Turn manifested permanent face up
 * 
 * Any time you have priority, you may turn a manifested permanent you control
 * face up. This is a special action that doesn't use the stack. To do this,
 * show all players that the card representing that permanent is a creature card
 * and what that card's mana cost is, pay that cost, then turn the permanent
 * face up.
 */
export function canTurnManifestFaceUp(
  permanent: { isCreature: boolean; hasManaCost: boolean }
): boolean {
  // Can only turn face up if it's a creature card with a mana cost
  return permanent.isCreature && permanent.hasManaCost;
}

/**
 * Rule 701.40c: Manifest with morph
 * 
 * If a card with morph is manifested, its controller may turn that card face up
 * using either the procedure to turn a face-down permanent with morph face up
 * or the procedure to turn a manifested permanent face up.
 */
export function canTurnFaceUpWithMorph(hasMorph: boolean): boolean {
  return hasMorph;
}

/**
 * Rule 701.40d: Manifest with disguise
 * 
 * If a card with disguise is manifested, its controller may turn that card face
 * up using either the procedure to turn a face-down permanent with disguise face
 * up or the procedure to turn a manifested permanent face up.
 */
export function canTurnFaceUpWithDisguise(hasDisguise: boolean): boolean {
  return hasDisguise;
}

/**
 * Rule 701.40e: Manifest multiple cards
 * 
 * If an effect instructs a player to manifest multiple cards from their library,
 * those cards are manifested one at a time.
 */
export const MANIFEST_ONE_AT_A_TIME = true;

/**
 * Rule 701.40g: Instant/sorcery can't turn face up when manifested
 * 
 * If a manifested permanent that's represented by an instant or sorcery card
 * would turn face up, its controller reveals it and leaves it face down.
 * Abilities that trigger whenever a permanent is turned face up won't trigger.
 */
export function canManifestedInstantSorceryTurnFaceUp(
  isInstantOrSorcery: boolean
): boolean {
  return !isInstantOrSorcery;
}

/**
 * Create manifested permanent state
 */
export function createManifestedPermanent(
  permanentId: string,
  originalCardId: string,
  isCreature: boolean,
  hasManaCost: boolean
): ManifestedPermanent {
  return {
    permanentId,
    originalCardId,
    isFaceDown: true,
    canTurnFaceUp: isCreature && hasManaCost,
  };
}
