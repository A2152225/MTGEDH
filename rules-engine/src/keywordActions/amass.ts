/**
 * Rule 701.47: Amass
 * 
 * To amass [subtype] N means "If you don't control an Army creature, create a
 * 0/0 black [subtype] Army creature token. Choose an Army creature you control.
 * Put N +1/+1 counters on that creature. If it isn't a [subtype], it becomes a
 * [subtype] in addition to its other types."
 * 
 * Reference: Rule 701.47
 */

export interface AmassAction {
  readonly type: 'amass';
  readonly playerId: string;
  readonly subtype: string;
  readonly n: number;
  readonly chosenArmyId?: string;
  readonly createdToken?: boolean;
}

/**
 * Rule 701.47a: Amass [subtype] N
 */
export function amass(
  playerId: string,
  subtype: string,
  n: number
): AmassAction {
  return {
    type: 'amass',
    playerId,
    subtype,
    n,
  };
}

/**
 * Complete amass with chosen Army
 */
export function completeAmass(
  playerId: string,
  subtype: string,
  n: number,
  chosenArmyId: string,
  createdToken: boolean
): AmassAction {
  return {
    type: 'amass',
    playerId,
    subtype,
    n,
    chosenArmyId,
    createdToken,
  };
}

/**
 * Rule 701.47b: Amassed even if impossible
 */
export const AMASSED_EVEN_IF_IMPOSSIBLE = true;

/**
 * Rule 701.47d: Default to Zombies
 */
export const DEFAULT_AMASS_SUBTYPE = 'Zombies';

export function normalizeAmassSubtype(subtype?: string): string {
  return subtype || DEFAULT_AMASS_SUBTYPE;
}
