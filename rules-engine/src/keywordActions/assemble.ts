/**
 * Rule 701.45: Assemble
 * 
 * Assemble is a keyword action in the Unstable set that puts Contraptions onto
 * the battlefield. Outside of silver-bordered cards, only one card (Steamflogger
 * Boss) refers to assembling a Contraption.
 * 
 * Note: Cards and mechanics from the Unstable set aren't fully included in these
 * rules. This is a placeholder implementation.
 * 
 * Reference: Rule 701.45
 */

export interface AssembleAction {
  readonly type: 'assemble';
  readonly playerId: string;
  readonly contraptionId?: string;
}

/**
 * Rule 701.45a: Assemble (silver-bordered/Un-set mechanic)
 */
export function assemble(playerId: string): AssembleAction {
  return {
    type: 'assemble',
    playerId,
  };
}

/**
 * Complete assemble
 */
export function completeAssemble(
  playerId: string,
  contraptionId: string
): AssembleAction {
  return {
    type: 'assemble',
    playerId,
    contraptionId,
  };
}

/**
 * Note about Un-set mechanics
 */
export const UN_SET_MECHANIC = true;
export const SEE_UNSTABLE_FAQ = 'See the Unstable FAQ for more information.';
