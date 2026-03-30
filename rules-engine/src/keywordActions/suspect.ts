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

export interface SuspectResult {
  readonly creatureId: string;
  readonly playerId: string;
  readonly becameSuspected: boolean;
  readonly grantsMenace: boolean;
  readonly cantBlock: boolean;
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

type SuspectCandidate = {
  readonly isCreature?: boolean;
  readonly type_line?: string;
  readonly card?: {
    readonly type_line?: string;
  };
};

function isCreatureLike(candidate: SuspectCandidate): boolean {
  if (candidate.isCreature === true) {
    return true;
  }

  const typeLine = String(candidate.type_line || candidate.card?.type_line || '').toLowerCase();
  return typeLine.includes('creature');
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
 * Remove the suspected designation.
 */
export function clearSuspectedState(state: SuspectedState): SuspectedState {
  return {
    ...state,
    isSuspected: false,
  };
}

/**
 * Validate a creature that can become suspected.
 */
export function canSuspectCreature(candidate: SuspectCandidate, isAlreadySuspected: boolean): boolean {
  return isCreatureLike(candidate) && !isAlreadySuspected;
}

/**
 * Suspected creatures can't block.
 */
export function canBlockWhileSuspected(isSuspected: boolean): boolean {
  return !isSuspected;
}

/**
 * Rule 701.60d: Can't become suspected again
 */
export function canBecomeSuspected(isSuspected: boolean): boolean {
  return !isSuspected;
}

export function createSuspectResult(
  action: SuspectAction,
  wasAlreadySuspected: boolean,
): SuspectResult {
  const becameSuspected = !wasAlreadySuspected;

  return {
    creatureId: action.creatureId,
    playerId: action.playerId,
    becameSuspected,
    grantsMenace: becameSuspected && SUSPECTED_ABILITIES.menace,
    cantBlock: becameSuspected && SUSPECTED_ABILITIES.cantBlock,
  };
}
