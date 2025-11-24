/**
 * Rule 701.43: Exert
 * 
 * To exert a permanent, you choose to have it not untap during your next untap step.
 * 
 * Reference: Rule 701.43
 */

export interface ExertAction {
  readonly type: 'exert';
  readonly permanentId: string;
  readonly controllerId: string;
}

/**
 * Rule 701.43a: Exert a permanent
 * 
 * To exert a permanent, you choose to have it not untap during your next untap step.
 */
export function exert(permanentId: string, controllerId: string): ExertAction {
  return {
    type: 'exert',
    permanentId,
    controllerId,
  };
}

/**
 * Rule 701.43b: Can exert even if untapped
 * 
 * A permanent can be exerted even if it's not tapped or has already been exerted
 * in a turn. If you exert a permanent more than once before your next untap step,
 * each effect causing it not to untap expires during the same untap step.
 */
export function canExert(permanent: {
  isOnBattlefield: boolean;
  isTapped?: boolean;
  isAlreadyExerted?: boolean;
}): boolean {
  // Rule 701.43c: Only permanents on battlefield can be exerted
  return permanent.isOnBattlefield;
}

/**
 * Rule 701.43c: Must be on battlefield
 * 
 * An object that isn't on the battlefield can't be exerted.
 */
export function mustBeOnBattlefield(isOnBattlefield: boolean): boolean {
  return isOnBattlefield;
}

/**
 * Exerted state tracking
 */
export interface ExertedState {
  readonly permanentId: string;
  readonly expiresOnNextUntapOf: string; // Player ID
  readonly exertCount: number; // How many times exerted
}

export function createExertedState(
  permanentId: string,
  controllerId: string
): ExertedState {
  return {
    permanentId,
    expiresOnNextUntapOf: controllerId,
    exertCount: 1,
  };
}

export function addExertion(state: ExertedState): ExertedState {
  return {
    ...state,
    exertCount: state.exertCount + 1,
  };
}

/**
 * Rule 701.43d: Exert as attack cost
 * 
 * "You may exert [this creature] as it attacks" is an optional cost to attack.
 */
export const EXERT_AS_ATTACK_COST = true;
