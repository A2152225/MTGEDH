/**
 * Section 4: Zones (Rules 400-408)
 * 
 * Implements zone system per MagicCompRules 20251114.txt
 * Zones are locations where objects exist during a game
 */

/**
 * Rule 400 - General
 * The seven zones: library, hand, battlefield, graveyard, stack, exile, command
 */
export enum Zone {
  LIBRARY = 'library',
  HAND = 'hand',
  BATTLEFIELD = 'battlefield',
  GRAVEYARD = 'graveyard',
  STACK = 'stack',
  EXILE = 'exile',
  COMMAND = 'command',
}

/**
 * Rule 400.2 - Public vs hidden zones
 */
export function isPublicZone(zone: Zone): boolean {
  return zone === Zone.BATTLEFIELD || 
         zone === Zone.GRAVEYARD || 
         zone === Zone.STACK || 
         zone === Zone.EXILE || 
         zone === Zone.COMMAND;
}

export function isHiddenZone(zone: Zone): boolean {
  return !isPublicZone(zone);
}

/**
 * Rule 401 - Library
 * A player's deck becomes their library when the game begins
 */
export interface Library {
  readonly ownerId: string;
  readonly cards: readonly string[]; // Card IDs, bottom to top
  readonly topCardRevealed: boolean; // Rule 401.5
}

export function createLibrary(ownerId: string, cardIds: readonly string[]): Library {
  return {
    ownerId,
    cards: [...cardIds],
    topCardRevealed: false,
  };
}

/**
 * Rule 401.2 - Library must be kept in a single face-down pile
 */
export function getTopCard(library: Library): string | undefined {
  return library.cards[library.cards.length - 1];
}

/**
 * Rule 401.3 - Any player may count cards in any library
 */
export function getLibrarySize(library: Library): number {
  return library.cards.length;
}

/**
 * Rule 401.7 - Putting cards "Nth from the top"
 */
export function putCardInLibrary(
  library: Library,
  cardId: string,
  position: number | 'top' | 'bottom'
): Library {
  const newCards = [...library.cards];
  
  if (position === 'top') {
    newCards.push(cardId);
  } else if (position === 'bottom') {
    newCards.unshift(cardId);
  } else {
    // Position N from top means index (length - N)
    const actualIndex = Math.max(0, newCards.length - position);
    newCards.splice(actualIndex, 0, cardId);
  }
  
  return { ...library, cards: newCards };
}

/**
 * Rule 402 - Hand
 * Where a player holds cards that have been drawn
 */
export interface Hand {
  readonly ownerId: string;
  readonly cards: readonly string[]; // Card IDs
}

export function createHand(ownerId: string): Hand {
  return {
    ownerId,
    cards: [],
  };
}

/**
 * Rule 402.2 - Maximum hand size (normally 7)
 */
export function getMaximumHandSize(): number {
  return 7;
}

/**
 * Rule 402.3 - A player can look at their own hand at any time
 */
export function getHandSize(hand: Hand): number {
  return hand.cards.length;
}

export function addCardToHand(hand: Hand, cardId: string): Hand {
  return {
    ...hand,
    cards: [...hand.cards, cardId],
  };
}

export function removeCardFromHand(hand: Hand, cardId: string): Hand {
  return {
    ...hand,
    cards: hand.cards.filter(id => id !== cardId),
  };
}

/**
 * Rule 403 - Battlefield
 * The area where permanents exist
 */
export interface Battlefield {
  readonly permanents: readonly string[]; // Permanent IDs
}

export function createBattlefield(): Battlefield {
  return {
    permanents: [],
  };
}

/**
 * Rule 403.3 - Every object on the battlefield is a permanent
 */
export function isPermanentOnBattlefield(battlefield: Battlefield, permanentId: string): boolean {
  return battlefield.permanents.includes(permanentId);
}

/**
 * Rule 403.4 - Whenever a permanent enters the battlefield, it becomes a new object
 */
export function addPermanentToBattlefield(battlefield: Battlefield, permanentId: string): Battlefield {
  return {
    ...battlefield,
    permanents: [...battlefield.permanents, permanentId],
  };
}

export function removePermanentFromBattlefield(battlefield: Battlefield, permanentId: string): Battlefield {
  return {
    ...battlefield,
    permanents: battlefield.permanents.filter(id => id !== permanentId),
  };
}

/**
 * Rule 404 - Graveyard
 * A player's discard pile
 */
export interface Graveyard {
  readonly ownerId: string;
  readonly cards: readonly string[]; // Card IDs, bottom to top (most recent on top)
}

export function createGraveyard(ownerId: string): Graveyard {
  return {
    ownerId,
    cards: [],
  };
}

/**
 * Rule 404.1 - Objects are put on top of graveyard
 */
export function putCardInGraveyard(graveyard: Graveyard, cardId: string): Graveyard {
  return {
    ...graveyard,
    cards: [...graveyard.cards, cardId],
  };
}

/**
 * Rule 404.2 - A player can examine any graveyard at any time
 */
export function getGraveyardCards(graveyard: Graveyard): readonly string[] {
  return graveyard.cards;
}

export function getTopGraveyardCard(graveyard: Graveyard): string | undefined {
  return graveyard.cards[graveyard.cards.length - 1];
}

/**
 * Rule 405 - Stack
 * Keeps track of the order that spells and abilities were added
 */
export interface StackObject {
  readonly id: string;
  readonly type: 'spell' | 'ability';
  readonly controllerId: string;
}

export interface Stack {
  readonly objects: readonly StackObject[]; // Bottom to top
}

export function createStack(): Stack {
  return {
    objects: [],
  };
}

/**
 * Rule 405.1 - When a spell is cast or ability activates/triggers, it goes on the stack
 */
export function pushToStack(stack: Stack, object: StackObject): Stack {
  return {
    ...stack,
    objects: [...stack.objects, object],
  };
}

/**
 * Rule 405.2 - Each time an object is put on the stack, it's put on top
 */
export function getTopStackObject(stack: Stack): StackObject | undefined {
  return stack.objects[stack.objects.length - 1];
}

/**
 * Rule 405.5 - When all players pass, the top spell/ability resolves
 */
export function popFromStack(stack: Stack): { stack: Stack; object: StackObject | undefined } {
  if (stack.objects.length === 0) {
    return { stack, object: undefined };
  }
  
  const newObjects = [...stack.objects];
  const object = newObjects.pop();
  
  return {
    stack: { objects: newObjects },
    object,
  };
}

export function isStackEmpty(stack: Stack): boolean {
  return stack.objects.length === 0;
}

/**
 * Rule 406 - Exile
 * Previously "removed-from-the-game zone"
 */
export interface ExiledCard {
  readonly cardId: string;
  readonly faceDown: boolean; // Rule 406.3
  readonly canBeExaminedBy: readonly string[]; // Player IDs who can look at this card
}

export interface Exile {
  readonly cards: readonly ExiledCard[];
}

export function createExile(): Exile {
  return {
    cards: [],
  };
}

/**
 * Rule 406.3 - Exiled cards are by default face up and may be examined by any player
 */
export function exileCard(
  exile: Exile,
  cardId: string,
  faceDown: boolean = false,
  canBeExaminedBy: readonly string[] = []
): Exile {
  return {
    ...exile,
    cards: [...exile.cards, { cardId, faceDown, canBeExaminedBy }],
  };
}

/**
 * Rule 406.3a - A card exiled face down has no characteristics
 */
export function canExamineExiledCard(card: ExiledCard, playerId: string): boolean {
  if (!card.faceDown) {
    return true; // Face-up cards can be examined by anyone
  }
  return card.canBeExaminedBy.includes(playerId);
}

/**
 * Rule 407 - Ante
 * Optional variation (not implemented - rarely used)
 */
export interface Ante {
  readonly cards: readonly string[];
}

export function createAnte(): Ante {
  return {
    cards: [],
  };
}

/**
 * Rule 408 - Command
 * Game area for specialized objects (emblems, commanders, etc.)
 */
export interface CommandZone {
  readonly objects: readonly string[]; // Object IDs
}

export function createCommandZone(): CommandZone {
  return {
    objects: [],
  };
}

/**
 * Rule 408.1 - Command zone is for objects that have an overarching effect
 * but are not permanents and cannot be destroyed
 */
export function addToCommandZone(commandZone: CommandZone, objectId: string): CommandZone {
  return {
    ...commandZone,
    objects: [...commandZone.objects, objectId],
  };
}

export function isInCommandZone(commandZone: CommandZone, objectId: string): boolean {
  return commandZone.objects.includes(objectId);
}

/**
 * Rule 400.11 - Outside the game
 * Not a zone, but referenced in rules
 */
export interface Sideboard {
  readonly ownerId: string;
  readonly cards: readonly string[];
}

export function createSideboard(ownerId: string, cardIds: readonly string[]): Sideboard {
  return {
    ownerId,
    cards: [...cardIds],
  };
}

/**
 * Rule 400.11a - Cards in a player's sideboard are outside the game
 */
export function isSideboardCard(sideboard: Sideboard, cardId: string): boolean {
  return sideboard.cards.includes(cardId);
}

/**
 * Helper: Complete zone state for a game
 */
export interface ZoneState {
  readonly libraries: ReadonlyMap<string, Library>; // Player ID -> Library
  readonly hands: ReadonlyMap<string, Hand>; // Player ID -> Hand
  readonly battlefield: Battlefield;
  readonly graveyards: ReadonlyMap<string, Graveyard>; // Player ID -> Graveyard
  readonly stack: Stack;
  readonly exile: Exile;
  readonly commandZone: CommandZone;
  readonly sideboards: ReadonlyMap<string, Sideboard>; // Player ID -> Sideboard
}

export function createZoneState(playerIds: readonly string[]): ZoneState {
  const libraries = new Map<string, Library>();
  const hands = new Map<string, Hand>();
  const graveyards = new Map<string, Graveyard>();
  const sideboards = new Map<string, Sideboard>();
  
  for (const playerId of playerIds) {
    libraries.set(playerId, createLibrary(playerId, []));
    hands.set(playerId, createHand(playerId));
    graveyards.set(playerId, createGraveyard(playerId));
    sideboards.set(playerId, createSideboard(playerId, []));
  }
  
  return {
    libraries,
    hands,
    battlefield: createBattlefield(),
    graveyards,
    stack: createStack(),
    exile: createExile(),
    commandZone: createCommandZone(),
    sideboards,
  };
}
