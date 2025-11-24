/**
 * Rule 701.32: Set in Motion
 * 
 * Only a scheme card may be set in motion, and only during an Archenemy game.
 * Only the archenemy may set a scheme card in motion.
 * 
 * Reference: Rule 701.32, also see Rule 314 "Schemes" and Rule 904 "Archenemy"
 */

export interface SetInMotionAction {
  readonly type: 'set-in-motion';
  readonly schemeId: string;
  readonly archenenemyId: string; // Player ID of the archenemy
}

/**
 * Rule 701.32a: Only scheme cards in Archenemy game
 * 
 * Only a scheme card may be set in motion, and only during an Archenemy game.
 * Only the archenemy may set a scheme card in motion.
 */
export function canSetInMotion(
  isArchenemyGame: boolean,
  isArchenemy: boolean,
  isSchemeCard: boolean
): boolean {
  return isArchenemyGame && isArchenemy && isSchemeCard;
}

/**
 * Rule 701.32b: Set a scheme in motion
 * 
 * To set a scheme in motion, move it off the top of your scheme deck if it's on
 * top of your scheme deck and turn it face up if it isn't face up. That scheme
 * is considered to have been set in motion even if neither of these actions was
 * performed on it.
 */
export function setInMotion(
  schemeId: string,
  archenenemyId: string
): SetInMotionAction {
  return {
    type: 'set-in-motion',
    schemeId,
    archenenemyId,
  };
}

/**
 * Rule 701.32c: One at a time
 * 
 * Schemes may only be set in motion one at a time. If a player is instructed to
 * set multiple schemes in motion, that player sets a scheme in motion that many
 * times.
 */
export const SET_IN_MOTION_ONE_AT_A_TIME = true;

export function setMultipleSchemesInMotion(
  schemeIds: readonly string[],
  archenenemyId: string
): readonly SetInMotionAction[] {
  // Set schemes in motion one at a time
  return schemeIds.map(schemeId => setInMotion(schemeId, archenenemyId));
}

/**
 * Set in motion result
 */
export interface SetInMotionResult {
  readonly schemeId: string;
  readonly wasOnTopOfDeck: boolean;
  readonly wasFaceDown: boolean;
  readonly movedOffDeck: boolean;
  readonly turnedFaceUp: boolean;
}

export function createSetInMotionResult(
  schemeId: string,
  wasOnTopOfDeck: boolean,
  wasFaceDown: boolean
): SetInMotionResult {
  return {
    schemeId,
    wasOnTopOfDeck,
    wasFaceDown,
    movedOffDeck: wasOnTopOfDeck,
    turnedFaceUp: wasFaceDown,
  };
}

/**
 * Check if a scheme is in motion (face up)
 */
export function isSchemeInMotion(isFaceUp: boolean): boolean {
  return isFaceUp;
}
