/**
 * Rule 701.56: Time Travel
 * 
 * To time travel means to choose any number of permanents you control with one or
 * more time counters on them and/or suspended cards you own in exile with one or
 * more time counters on them and, for each of those objects, put a time counter on
 * it or remove a time counter from it.
 * 
 * Reference: Rule 701.56, also see Rule 702.62 "Suspend"
 */

export interface TimeTravelAction {
  readonly type: 'time-travel';
  readonly playerId: string;
  readonly chosenObjects: readonly {
    readonly objectId: string;
    readonly addCounter: boolean; // true = add, false = remove
  }[];
}

export interface TimeTravelChoice {
  readonly objectId: string;
  readonly addCounter: boolean;
}

export interface TimeTravelActionResult {
  readonly playerId: string;
  readonly choiceCount: number;
  readonly validSelection: boolean;
  readonly netCounterChange: number;
  readonly affectsPermanents: boolean;
  readonly affectsSuspendedCards: boolean;
}

export interface TimeTravelChosenObject extends TimeTravelChoice {
  readonly isPermanent?: boolean;
  readonly isSuspended?: boolean;
}

type TimeTravelCandidate = {
  readonly isControlled?: boolean;
  readonly isOwned?: boolean;
  readonly isPermanent?: boolean;
  readonly isSuspended?: boolean;
  readonly hasTimeCounters: boolean;
};

/**
 * Rule 701.56a: Time travel
 */
export function timeTravel(
  playerId: string,
  chosenObjects: readonly TimeTravelChoice[]
): TimeTravelAction {
  return {
    type: 'time-travel',
    playerId,
    chosenObjects,
  };
}

/**
 * Check if object can be time traveled
 */
export function canTimeTravel(
  object: TimeTravelCandidate
): boolean {
  if (!object.hasTimeCounters) return false;

  const canChoosePermanent = object.isPermanent === true && object.isControlled === true;
  const canChooseSuspendedCard = object.isSuspended === true && (object.isOwned === true || object.isControlled === true);

  return canChoosePermanent || canChooseSuspendedCard;
}

/**
 * Time travel result
 */
export interface TimeTravelResult {
  readonly objectId: string;
  readonly previousCounters: number;
  readonly newCounters: number;
  readonly added: boolean;
}

export function createTimeTravelResult(
  objectId: string,
  previousCounters: number,
  added: boolean
): TimeTravelResult {
  return {
    objectId,
    previousCounters,
    newCounters: getTimeTravelCounterResult(previousCounters, added),
    added,
  };
}

/**
 * Apply a single time-travel counter change, clamping removals at zero.
 */
export function getTimeTravelCounterResult(previousCounters: number, added: boolean): number {
  return added ? previousCounters + 1 : Math.max(0, previousCounters - 1);
}

/**
 * Validate the chosen objects for a time-travel action.
 */
export function isValidTimeTravelSelection(
  chosenObjects: readonly TimeTravelChoice[],
  eligibleObjectIds: readonly string[],
): boolean {
  const eligible = new Set(eligibleObjectIds);
  const seen = new Set<string>();

  for (const choice of chosenObjects) {
    if (!eligible.has(choice.objectId) || seen.has(choice.objectId)) {
      return false;
    }

    seen.add(choice.objectId);
  }

  return true;
}

export function affectsSuspendedCards(
  chosenObjects: readonly TimeTravelChosenObject[],
): boolean {
  return chosenObjects.some((choice) => choice.isSuspended === true);
}

export function affectsBattlefieldPermanents(
  chosenObjects: readonly TimeTravelChosenObject[],
): boolean {
  return chosenObjects.some((choice) => choice.isPermanent === true);
}

/**
 * Net number of counters added minus removed across a time-travel choice set.
 */
export function getNetTimeTravelCounterChange(chosenObjects: readonly TimeTravelChoice[]): number {
  return chosenObjects.reduce((sum, choice) => sum + (choice.addCounter ? 1 : -1), 0);
}

export function createTimeTravelActionResult(
  action: TimeTravelAction,
  eligibleObjectIds: readonly string[],
  chosenObjects: readonly TimeTravelChosenObject[] = action.chosenObjects,
): TimeTravelActionResult {
  return {
    playerId: action.playerId,
    choiceCount: action.chosenObjects.length,
    validSelection: isValidTimeTravelSelection(action.chosenObjects, eligibleObjectIds),
    netCounterChange: getNetTimeTravelCounterChange(action.chosenObjects),
    affectsPermanents: affectsBattlefieldPermanents(chosenObjects),
    affectsSuspendedCards: affectsSuspendedCards(chosenObjects),
  };
}
