/**
 * Rule 701.20: Reveal
 * 
 * To reveal a card, show that card to all players for a brief time.
 * 
 * Reference: Rule 701.20
 */

export interface RevealAction {
  readonly type: 'reveal';
  readonly playerId: string;
  readonly cardIds: readonly string[];
  readonly fromZone: string;
}

/**
 * Rule 701.20a: Reveal cards
 * 
 * To reveal a card, show that card to all players for a brief time. If an
 * effect causes a card to be revealed, it remains revealed for as long as
 * necessary to complete the parts of the effect that card is relevant to.
 */
export function revealCards(
  playerId: string,
  cardIds: readonly string[],
  fromZone: string = 'hand'
): RevealAction {
  return {
    type: 'reveal',
    playerId,
    cardIds,
    fromZone,
  };
}

/**
 * Rule 701.20b: Revealing from hidden zones
 * 
 * If cards in a player's library are revealed, they remain in the library in
 * the same order unless an effect says otherwise. The same is true of cards
 * revealed from the top of a player's library.
 */
export interface RevealResult {
  readonly revealed: boolean;
  readonly cardIds: readonly string[];
  readonly remainInZone: boolean;
  readonly maintainOrder: boolean; // For library reveals
}

export interface RevealSummary {
  readonly playerId: string;
  readonly cardCount: number;
  readonly fromZone: string;
  readonly fromHiddenZone: boolean;
  readonly maintainOrder: boolean;
}

export function createRevealResult(
  cardIds: readonly string[],
  fromZone: string
): RevealResult {
  return {
    revealed: true,
    cardIds,
    remainInZone: fromZone !== 'hand', // Usually remain in zone unless from hand
    maintainOrder: fromZone === 'library',
  };
}

/**
 * Rule 701.20c: Reveal vs. Look
 * 
 * Revealing a card doesn't cause it to leave the zone it's in.
 */
export function revealDoesNotMoveCard(): boolean {
  return true;
}

export function revealsFromHiddenZone(action: RevealAction): boolean {
  return action.fromZone === 'library' || action.fromZone === 'hand';
}

export function createRevealSummary(action: RevealAction): RevealSummary {
  const result = createRevealResult(action.cardIds, action.fromZone);

  return {
    playerId: action.playerId,
    cardCount: action.cardIds.length,
    fromZone: action.fromZone,
    fromHiddenZone: revealsFromHiddenZone(action),
    maintainOrder: result.maintainOrder,
  };
}
