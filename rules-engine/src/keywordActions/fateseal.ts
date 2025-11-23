/**
 * Rule 701.29: Fateseal
 * 
 * To "fateseal N" means to look at the top N cards of an opponent's library,
 * then put any number of them on the bottom of that library in any order and
 * the rest on top of that library in any order.
 * 
 * Reference: Rule 701.29
 */

export interface FatesealAction {
  readonly type: 'fateseal';
  readonly playerId: string; // Player performing the fateseal
  readonly opponentId: string; // Opponent whose library is fatesealed
  readonly count: number;
  readonly topCards?: readonly string[]; // Cards to keep on top (in order)
  readonly bottomCards?: readonly string[]; // Cards to put on bottom (in order)
}

/**
 * Rule 701.29a: Fateseal N
 * 
 * To "fateseal N" means to look at the top N cards of an opponent's library,
 * then put any number of them on the bottom of that library in any order and
 * the rest on top of that library in any order.
 */
export function fateseal(
  playerId: string,
  opponentId: string,
  count: number
): FatesealAction {
  return {
    type: 'fateseal',
    playerId,
    opponentId,
    count,
  };
}

/**
 * Complete a fateseal action with decisions
 */
export function completeFateseal(
  playerId: string,
  opponentId: string,
  count: number,
  topCards: readonly string[],
  bottomCards: readonly string[]
): FatesealAction {
  // Validate that all fatesealed cards are accounted for
  if (topCards.length + bottomCards.length !== count) {
    throw new Error('Fateseal decision must account for all cards');
  }
  
  return {
    type: 'fateseal',
    playerId,
    opponentId,
    count,
    topCards,
    bottomCards,
  };
}

/**
 * Get actual fateseal count (limited by opponent's library size)
 */
export function getActualFatesealCount(
  opponentLibrarySize: number,
  requestedCount: number
): number {
  return Math.min(opponentLibrarySize, requestedCount);
}

/**
 * Fateseal is similar to scry but targets an opponent's library
 */
export const FATESEAL_TARGETS_OPPONENT_LIBRARY = true;
