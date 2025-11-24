/**
 * Rule 701.17: Mill
 * 
 * For a player to mill a number of cards, that player puts that many cards from
 * the top of their library into their graveyard.
 * 
 * Reference: Rule 701.17
 */

export interface MillAction {
  readonly type: 'mill';
  readonly playerId: string;
  readonly count: number;
}

/**
 * Rule 701.17a: Mill cards from library to graveyard
 * 
 * For a player to mill a number of cards, that player puts that many cards from
 * the top of their library into their graveyard.
 */
export function millCards(playerId: string, count: number): MillAction {
  return {
    type: 'mill',
    playerId,
    count,
  };
}

/**
 * Rule 701.17b: Can't mill more than library size
 * 
 * A player can't mill a number of cards greater than the number of cards in
 * their library. If given the choice to do so, they can't choose to take that
 * action. If instructed to do so, they mill as many as possible.
 */
export function canMillCount(librarySize: number, requestedCount: number): boolean {
  return requestedCount <= librarySize;
}

export function getActualMillCount(
  librarySize: number,
  requestedCount: number
): number {
  return Math.min(librarySize, requestedCount);
}

/**
 * Rule 701.17c: Finding milled cards
 * 
 * An effect that refers to a milled card can find that card in the zone it moved
 * to from the library, as long as that zone is a public zone.
 */
export function canFindMilledCard(destinationZone: string): boolean {
  // Public zones: battlefield, graveyard, exile (face-up), stack
  const publicZones = ['battlefield', 'graveyard', 'exile', 'stack'];
  return publicZones.includes(destinationZone);
}

/**
 * Rule 701.17d: Multiple milled cards
 * 
 * If an ability checks information about a single milled card but more than one
 * card was milled, that ability refers to each of the milled cards. If that
 * ability asks for any information about the milled card, such as a characteristic
 * or mana value, it gets multiple answers. If these answers are used to determine
 * the value of a variable, the sum of the answers is used.
 */
export interface MillResult {
  readonly playerId: string;
  readonly milledCards: readonly string[];
  readonly destinationZone: string;
}

export function createMillResult(
  playerId: string,
  milledCards: readonly string[],
  destinationZone: string = 'graveyard'
): MillResult {
  return {
    playerId,
    milledCards,
    destinationZone,
  };
}
