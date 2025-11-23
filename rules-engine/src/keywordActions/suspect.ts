/**
 * Rule 701.60: Suspect
 * 
 * Certain spells and abilities instruct a player to suspect a creature. That
 * creature becomes suspected until it leaves the battlefield or until a spell or
 * ability causes it to no longer be suspected.
 * 
 * Reference: Rule 701.60
 */

export interface SuspectAction {
  readonly type: 'suspect';
  readonly creatureId: string;
  readonly playerId: string;
}

/**
 * Rule 701.60a: Suspect a creature
 */
export function suspect(creatureId: string, playerId: string): SuspectAction {
  return {
    type: 'suspect',
    creatureId,
    playerId,
  };
}

/**
 * Rule 701.60b: Suspected designation
 */
export interface SuspectedState {
  readonly creatureId: string;
  readonly isSuspected: boolean;
}

export function createSuspectedState(creatureId: string): SuspectedState {
  return {
    creatureId,
    isSuspected: true,
  };
}

/**
 * Rule 701.60c: Suspected abilities
 * 
 * A suspected permanent has menace and "This creature can't block" for as long
 * as it's suspected.
 */
export const SUSPECTED_ABILITIES = {
  menace: true,
  cantBlock: true,
} as const;

/**
 * Rule 701.60d: Can't become suspected again
 */
export function canBecomeSuspected(isSuspected: boolean): boolean {
  return !isSuspected;
}
