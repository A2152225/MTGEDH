/**
 * Rule 701.53: Incubate
 * 
 * To incubate N, create an Incubator token that enters the battlefield with N
 * +1/+1 counters on it.
 * 
 * Reference: Rule 701.53, also see Rule 111.10i
 */

export interface IncubateAction {
  readonly type: 'incubate';
  readonly playerId: string;
  readonly n: number;
  readonly tokenId?: string;
}

/**
 * Rule 701.53a: Incubate N
 */
export function incubate(playerId: string, n: number): IncubateAction {
  return {
    type: 'incubate',
    playerId,
    n,
  };
}

/**
 * Complete incubate with created token
 */
export function completeIncubate(
  playerId: string,
  n: number,
  tokenId: string
): IncubateAction {
  return {
    type: 'incubate',
    playerId,
    n,
    tokenId,
  };
}

/**
 * Rule 701.53b: Incubator token properties
 */
export const INCUBATOR_TOKEN = {
  frontFace: {
    types: ['Artifact'],
    subtypes: ['Incubator'],
    colors: [],
    ability: '{2}: Transform this token.',
  },
  backFace: {
    name: 'Phyrexian Token',
    types: ['Artifact', 'Creature'],
    subtypes: ['Phyrexian'],
    colors: [],
    power: 0,
    toughness: 0,
  },
} as const;
