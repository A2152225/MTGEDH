/**
 * Rule 701.8: Destroy
 * 
 * To destroy a permanent, move it from the battlefield to its owner's graveyard.
 */

export interface DestroyAction {
  readonly type: 'destroy';
  readonly permanentId: string;
}

/**
 * Rule 701.8b: Ways a permanent can be destroyed
 * 
 * The only ways a permanent can be destroyed are as a result of an effect that
 * uses the word "destroy" or as a result of the state-based actions that check
 * for lethal damage (see rule 704.5g) or damage from a source with deathtouch
 * (see rule 704.5h).
 */
export enum DestructionCause {
  DESTROY_KEYWORD = 'destroy-keyword',
  LETHAL_DAMAGE = 'lethal-damage', // Rule 704.5g
  DEATHTOUCH_DAMAGE = 'deathtouch-damage', // Rule 704.5h
}

export interface DestroyResult {
  readonly destroyed: boolean;
  readonly cause: DestructionCause;
  readonly regenerated: boolean; // Rule 701.8c
}

export function destroyPermanent(
  permanentId: string,
  cause: DestructionCause = DestructionCause.DESTROY_KEYWORD
): DestroyAction {
  return {
    type: 'destroy',
    permanentId,
  };
}

/**
 * Rule 701.8c: Regeneration
 * 
 * A regeneration effect replaces a destruction event.
 * See rule 701.19, "Regenerate."
 */
export function canBeDestroyed(
  permanentId: string,
  hasRegenerationShield: boolean
): boolean {
  // If regeneration shield, destruction is replaced
  return !hasRegenerationShield;
}
