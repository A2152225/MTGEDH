/**
 * Rule 701.33: Abandon
 * 
 * Only a face-up ongoing scheme card may be abandoned, and only during an
 * Archenemy game.
 * 
 * Reference: Rule 701.33, also see Rule 314 "Schemes" and Rule 904 "Archenemy"
 */

export interface AbandonAction {
  readonly type: 'abandon';
  readonly schemeId: string;
  readonly ownerId: string; // Owner of the scheme deck
}

/**
 * Rule 701.33a: Only face-up ongoing schemes
 * 
 * Only a face-up ongoing scheme card may be abandoned, and only during an
 * Archenemy game.
 */
export function canAbandon(
  isArchenemyGame: boolean,
  isFaceUp: boolean,
  isOngoing: boolean
): boolean {
  return isArchenemyGame && isFaceUp && isOngoing;
}

/**
 * Rule 701.33b: Abandon a scheme
 * 
 * To abandon a scheme, turn it face down and put it on the bottom of its owner's
 * scheme deck.
 */
export function abandon(schemeId: string, ownerId: string): AbandonAction {
  return {
    type: 'abandon',
    schemeId,
    ownerId,
  };
}

/**
 * Abandon result
 */
export interface AbandonResult {
  readonly schemeId: string;
  readonly turnedFaceDown: boolean;
  readonly movedToBottomOfDeck: boolean;
}

export function createAbandonResult(schemeId: string): AbandonResult {
  return {
    schemeId,
    turnedFaceDown: true,
    movedToBottomOfDeck: true,
  };
}

/**
 * Check if a scheme is ongoing
 */
export function isOngoingScheme(schemeType: 'ongoing' | 'non-ongoing'): boolean {
  return schemeType === 'ongoing';
}

/**
 * Validate scheme state for abandoning
 */
export function validateAbandonState(
  scheme: {
    isFaceUp: boolean;
    isOngoing: boolean;
    isArchenemyGame: boolean;
  }
): { canAbandon: boolean; reason?: string } {
  if (!scheme.isArchenemyGame) {
    return { canAbandon: false, reason: 'Not an Archenemy game' };
  }
  
  if (!scheme.isFaceUp) {
    return { canAbandon: false, reason: 'Scheme is not face up' };
  }
  
  if (!scheme.isOngoing) {
    return { canAbandon: false, reason: 'Scheme is not ongoing' };
  }
  
  return { canAbandon: true };
}
