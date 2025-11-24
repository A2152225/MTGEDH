/**
 * Rule 701.66: Earthbend
 * 
 * "Earthbend N" means "Target land you control becomes a 0/0 land creature with
 * haste in addition to its other types. Put N +1/+1 counters on it. When that
 * land dies or is put into exile, return it to the battlefield tapped under your
 * control."
 * 
 * Reference: Rule 701.66
 */

export interface EarthbendAction {
  readonly type: 'earthbend';
  readonly playerId: string;
  readonly landId: string;
  readonly n: number;
}

/**
 * Rule 701.66a: Earthbend N
 */
export function earthbend(
  playerId: string,
  landId: string,
  n: number
): EarthbendAction {
  return {
    type: 'earthbend',
    playerId,
    landId,
    n,
  };
}

/**
 * Earthbended land properties
 */
export const EARTHBENDED_PROPERTIES = {
  basePower: 0,
  baseToughness: 0,
  addedTypes: ['Creature'],
  hasHaste: true,
} as const;

/**
 * Rule 701.66b: Earthbend trigger
 */
export interface EarthbendDelayedTrigger {
  readonly landId: string;
  readonly ownerId: string;
  readonly returnsWhenDiesOrExiled: boolean;
}

export function createEarthbendTrigger(
  landId: string,
  ownerId: string
): EarthbendDelayedTrigger {
  return {
    landId,
    ownerId,
    returnsWhenDiesOrExiled: true,
  };
}
