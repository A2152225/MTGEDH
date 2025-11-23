/**
 * Rule 701.36: Populate
 * 
 * To populate means to choose a creature token you control and create a token
 * that's a copy of that creature token.
 * 
 * Reference: Rule 701.36
 */

export interface PopulateAction {
  readonly type: 'populate';
  readonly playerId: string;
  readonly chosenTokenId?: string; // Token to copy
}

/**
 * Rule 701.36a: Populate
 * 
 * To populate means to choose a creature token you control and create a token
 * that's a copy of that creature token.
 */
export function populate(playerId: string, chosenTokenId?: string): PopulateAction {
  return {
    type: 'populate',
    playerId,
    chosenTokenId,
  };
}

/**
 * Rule 701.36b: No creature tokens
 * 
 * If you control no creature tokens when instructed to populate, you won't
 * create a token.
 */
export function canPopulate(creatureTokens: readonly string[]): boolean {
  return creatureTokens.length > 0;
}

/**
 * Complete populate action with chosen token
 */
export function completePopulate(
  playerId: string,
  chosenTokenId: string
): PopulateAction {
  return {
    type: 'populate',
    playerId,
    chosenTokenId,
  };
}

/**
 * Populate result
 */
export interface PopulateResult {
  readonly populated: boolean;
  readonly originalTokenId: string | null;
  readonly newTokenId: string | null;
}

export function createPopulateResult(
  originalTokenId: string | null,
  newTokenId: string | null
): PopulateResult {
  return {
    populated: originalTokenId !== null && newTokenId !== null,
    originalTokenId,
    newTokenId,
  };
}
