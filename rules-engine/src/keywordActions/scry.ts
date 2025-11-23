/**
 * Rule 701.22: Scry
 * 
 * To "scry N" means to look at the top N cards of your library, then put any
 * number of them on the bottom of your library in any order and the rest on top
 * of your library in any order.
 * 
 * Reference: Rule 701.22
 */

export interface ScryAction {
  readonly type: 'scry';
  readonly playerId: string;
  readonly count: number;
  readonly topCards?: readonly string[]; // Cards to keep on top (in order)
  readonly bottomCards?: readonly string[]; // Cards to put on bottom (in order)
}

/**
 * Rule 701.22a: Scry N
 * 
 * To "scry N" means to look at the top N cards of your library, then put any
 * number of them on the bottom of your library in any order and the rest on top
 * of your library in any order.
 */
export function scry(playerId: string, count: number): ScryAction {
  return {
    type: 'scry',
    playerId,
    count,
  };
}

/**
 * Rule 701.22b: Can't scry more than library size
 * 
 * If a player is instructed to scry a number greater than the number of cards
 * in their library, they scry a number equal to the number of cards in their
 * library.
 */
export function getActualScryCount(
  librarySize: number,
  requestedCount: number
): number {
  return Math.min(librarySize, requestedCount);
}

/**
 * Complete a scry action with decisions
 */
export function completeScry(
  playerId: string,
  count: number,
  topCards: readonly string[],
  bottomCards: readonly string[]
): ScryAction {
  // Validate that all scried cards are accounted for
  if (topCards.length + bottomCards.length !== count) {
    throw new Error('Scry decision must account for all cards');
  }
  
  return {
    type: 'scry',
    playerId,
    count,
    topCards,
    bottomCards,
  };
}

/**
 * Rule 701.22c: Scry 0
 * 
 * If a player is instructed to scry 0, no scry event occurs. Abilities that
 * trigger whenever a player scries won't trigger.
 */
export function shouldTriggerScry(count: number): boolean {
  return count > 0;
}
