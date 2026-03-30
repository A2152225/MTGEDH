/**
 * Rule 701.46: Adapt
 * 
 * "Adapt N" means "If this permanent has no +1/+1 counters on it, put N +1/+1
 * counters on it."
 * 
 * Reference: Rule 701.46
 */

export interface AdaptAction {
  readonly type: 'adapt';
  readonly permanentId: string;
  readonly n: number;
  readonly hadCounters: boolean;
}

export interface AdaptResult {
  readonly permanentId: string;
  readonly requestedCounters: number;
  readonly countersAdded: number;
  readonly hadCounters: boolean;
  readonly adaptsSuccessfully: boolean;
}

/**
 * Rule 701.46a: Adapt N
 */
export function adapt(
  permanentId: string,
  n: number,
  currentCounters: number
): AdaptAction {
  return {
    type: 'adapt',
    permanentId,
    n,
    hadCounters: currentCounters > 0,
  };
}

/**
 * Check if adapt will add counters
 */
export function willAdaptAddCounters(currentCounters: number): boolean {
  return currentCounters === 0;
}

export function isAdaptLocked(currentCounters: number): boolean {
  return currentCounters > 0;
}

/**
 * Get counters to add from adapt
 */
export function getAdaptCounters(n: number, currentCounters: number): number {
  return currentCounters === 0 ? n : 0;
}

export function createAdaptResult(action: AdaptAction): AdaptResult {
  const countersAdded = action.hadCounters ? 0 : action.n;

  return {
    permanentId: action.permanentId,
    requestedCounters: action.n,
    countersAdded,
    hadCounters: action.hadCounters,
    adaptsSuccessfully: countersAdded > 0,
  };
}
