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
 * Assemble requires an available Contraption to complete.
 */
export function canAssemble(availableContraptionIds: readonly string[]): boolean {
  return availableContraptionIds.length > 0;
}

/**
 * Return the assembled Contraption, if one was chosen.
 */
export function getAssembledContraption(action: AssembleAction): string | undefined {
  return action.contraptionId;
}

/**
 * Un-set mechanics remain explicitly flagged as non-black-border placeholder coverage.
 */
export function isUnSetAssembleAction(): boolean {
  return UN_SET_MECHANIC;
}

/**
 * Note about Un-set mechanics
 */
export const UN_SET_MECHANIC = true;
export const SEE_UNSTABLE_FAQ = 'See the Unstable FAQ for more information.';
