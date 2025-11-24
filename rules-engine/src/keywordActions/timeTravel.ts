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

/**
 * Rule 701.56a: Time travel
 */
export function timeTravel(
  playerId: string,
  chosenObjects: readonly {
    objectId: string;
    addCounter: boolean;
  }[]
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
  object: {
    isControlled: boolean;
    isPermanent?: boolean;
    isSuspended?: boolean;
    hasTimeCounters: boolean;
  }
): boolean {
  if (!object.hasTimeCounters) return false;
  if (!object.isControlled) return false;
  
  // Must be a permanent with time counters or suspended card
  return (object.isPermanent === true) || (object.isSuspended === true);
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
    newCounters: added ? previousCounters + 1 : previousCounters - 1,
    added,
  };
}
