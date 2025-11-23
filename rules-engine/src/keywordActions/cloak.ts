/**
 * Rule 701.58: Cloak
 * 
 * To cloak a card, turn it face down. It becomes a 2/2 face-down creature card
 * with ward {2}, no name, no subtypes, and no mana cost. Put that card onto the
 * battlefield face down.
 * 
 * Reference: Rule 701.58, also see Rule 708 "Face-Down Spells and Permanents"
 */

export interface CloakAction {
  readonly type: 'cloak';
  readonly playerId: string;
  readonly cardIds: readonly string[];
  readonly fromZone: string;
}

/**
 * Rule 701.58a: Cloak a card
 */
export function cloak(
  playerId: string,
  cardIds: readonly string[],
  fromZone: string = 'library'
): CloakAction {
  return {
    type: 'cloak',
    playerId,
    cardIds,
    fromZone,
  };
}

/**
 * Cloaked characteristics (Rule 701.58a)
 */
export const CLOAKED_CHARACTERISTICS = {
  power: 2,
  toughness: 2,
  types: ['Creature'],
  subtypes: [],
  name: '',
  text: '',
  manaCost: undefined,
  colors: [],
  ward: 2,
} as const;

/**
 * Rule 701.58b: Turn cloaked permanent face up
 */
export function canTurnCloakedFaceUp(
  permanent: { isCreature: boolean; hasManaCost: boolean }
): boolean {
  return permanent.isCreature && permanent.hasManaCost;
}

/**
 * Rule 701.58e: Cloak one at a time
 */
export const CLOAK_ONE_AT_A_TIME = true;

/**
 * Rule 701.58g: Instant/sorcery can't turn face up
 */
export function canInstantSorceryTurnFaceUp(
  isInstantOrSorcery: boolean
): boolean {
  return !isInstantOrSorcery;
}
