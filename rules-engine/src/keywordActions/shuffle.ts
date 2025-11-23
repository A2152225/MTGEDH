/**
 * Rule 701.24: Shuffle
 * 
 * To shuffle a library or a deck, randomize the cards within it.
 * 
 * Reference: Rule 701.24
 */

export interface ShuffleAction {
  readonly type: 'shuffle';
  readonly playerId: string;
  readonly zone: 'library' | 'deck'; // Usually library, sometimes deck (in casual formats)
}

/**
 * Rule 701.24a: Randomize cards
 * 
 * To shuffle a library or a deck, randomize the cards within it. After a library
 * or deck is shuffled, the order of the cards in it can't be known to any player
 * unless an effect says otherwise.
 */
export function shuffleLibrary(playerId: string): ShuffleAction {
  return {
    type: 'shuffle',
    playerId,
    zone: 'library',
  };
}

/**
 * Rule 701.24b: Shuffle into library
 * 
 * If an effect would cause a player to shuffle one or more specific objects into
 * a library, that library is shuffled even if all those objects are already in
 * that library.
 */
export function shouldShuffle(
  cardsToShuffle: readonly string[],
  alreadyInLibrary: readonly string[]
): boolean {
  // Always shuffle, even if all cards are already in library
  return true;
}

/**
 * Rule 701.24c: Shuffle triggers
 * 
 * If an effect would cause a player to shuffle one or more cards from a public
 * zone into a hidden zone, all players see where those cards came from.
 */
export interface ShuffleFromPublicZone {
  readonly fromZone: string;
  readonly cardIds: readonly string[];
  readonly visible: boolean; // Always true for public zone
}

export function shuffleCardsIntoLibrary(
  playerId: string,
  cardIds: readonly string[],
  fromZone: string
): ShuffleAction {
  return {
    type: 'shuffle',
    playerId,
    zone: 'library',
  };
}

/**
 * Rule 701.24d: Ability to shuffle
 * 
 * If an ability refers to a player shuffling a library, that ability can't cause
 * a player to shuffle a library that doesn't exist. If part of an effect has a
 * player shuffle a library, and that library doesn't exist, that part of the
 * effect is ignored.
 */
export function canShuffleLibrary(libraryExists: boolean): boolean {
  return libraryExists;
}
