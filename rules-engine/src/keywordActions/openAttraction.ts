/**
 * Rule 701.51: Open an Attraction
 * 
 * A player may open an Attraction only during a game in which that player is
 * playing with an Attraction deck.
 * 
 * Reference: Rule 701.51, also see Rule 717 "Attraction Cards"
 */

export interface OpenAttractionAction {
  readonly type: 'open-attraction';
  readonly playerId: string;
  readonly attractionId?: string;
}

/**
 * Rule 701.51a: Can only open in Attraction game
 */
export function canOpenAttraction(hasAttractionDeck: boolean): boolean {
  return hasAttractionDeck;
}

/**
 * Rule 701.51b: Open an Attraction
 */
export function openAttraction(playerId: string): OpenAttractionAction {
  return {
    type: 'open-attraction',
    playerId,
  };
}

/**
 * Complete open attraction
 */
export function completeOpenAttraction(
  playerId: string,
  attractionId: string
): OpenAttractionAction {
  return {
    type: 'open-attraction',
    playerId,
    attractionId,
  };
}

/**
 * Rule 701.51c: Triggers when opening
 */
export const TRIGGERS_WHEN_OPENING = true;
