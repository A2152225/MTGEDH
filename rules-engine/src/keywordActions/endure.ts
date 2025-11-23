/**
 * Rule 701.63: Endure
 * 
 * Certain abilities instruct a permanent to endure N. To do so, that permanent's
 * controller creates an N/N white Spirit creature token unless they put N +1/+1
 * counters on that permanent.
 * 
 * Reference: Rule 701.63
 */

export interface EndureAction {
  readonly type: 'endure';
  readonly permanentId: string;
  readonly controllerId: string;
  readonly n: number;
  readonly putCounters?: boolean;
  readonly createdToken?: boolean;
  readonly tokenId?: string;
}

/**
 * Rule 701.63a: Endure N
 */
export function endure(
  permanentId: string,
  controllerId: string,
  n: number
): EndureAction {
  return {
    type: 'endure',
    permanentId,
    controllerId,
    n,
  };
}

/**
 * Complete endure with choice
 */
export function endureWithCounters(
  permanentId: string,
  controllerId: string,
  n: number
): EndureAction {
  return {
    type: 'endure',
    permanentId,
    controllerId,
    n,
    putCounters: true,
    createdToken: false,
  };
}

export function endureWithToken(
  permanentId: string,
  controllerId: string,
  n: number,
  tokenId: string
): EndureAction {
  return {
    type: 'endure',
    permanentId,
    controllerId,
    n,
    putCounters: false,
    createdToken: true,
    tokenId,
  };
}

/**
 * Rule 701.63b: Endure 0 does nothing
 */
export function endureDoesNothing(n: number): boolean {
  return n === 0;
}
