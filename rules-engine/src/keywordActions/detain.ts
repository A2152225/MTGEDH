/**
 * Rule 701.35: Detain
 * 
 * Certain spells and abilities can detain a permanent. Until the next turn of
 * the controller of that spell or ability, that permanent can't attack or block
 * and its activated abilities can't be activated.
 * 
 * Reference: Rule 701.35
 */

export interface DetainAction {
  readonly type: 'detain';
  readonly permanentId: string;
  readonly detainerId: string; // Controller of the spell/ability that detained
}

export interface DetainedState {
  readonly permanentId: string;
  readonly detainedBy: string; // Player ID
  readonly expiresOnTurnOf: string; // Expires at start of this player's next turn
  readonly timestamp: number;
}

/**
 * Rule 701.35a: Detain a permanent
 * 
 * Certain spells and abilities can detain a permanent. Until the next turn of
 * the controller of that spell or ability, that permanent can't attack or block
 * and its activated abilities can't be activated.
 */
export function detainPermanent(
  permanentId: string,
  detainerId: string
): DetainAction {
  return {
    type: 'detain',
    permanentId,
    detainerId,
  };
}

/**
 * Create detained state
 */
export function createDetainedState(
  permanentId: string,
  detainerId: string,
  currentTurnPlayer: string
): DetainedState {
  return {
    permanentId,
    detainedBy: detainerId,
    expiresOnTurnOf: detainerId,
    timestamp: Date.now(),
  };
}

/**
 * Check if a permanent is currently detained
 */
export function isDetained(
  state: DetainedState | null,
  currentTurnPlayer: string
): boolean {
  if (!state) return false;
  
  // Detained until the start of detainer's next turn
  return currentTurnPlayer !== state.expiresOnTurnOf;
}

/**
 * Detained permanent restrictions
 */
export function canAttackIfDetained(detained: boolean): boolean {
  return !detained;
}

export function canBlockIfDetained(detained: boolean): boolean {
  return !detained;
}

export function canActivateAbilitiesIfDetained(detained: boolean): boolean {
  return !detained;
}
