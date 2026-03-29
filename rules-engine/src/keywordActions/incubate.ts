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

/**
 * Incubate only produces meaningful counters for positive values.
 */
export function getIncubateCounterCount(n: number): number {
  return Math.max(0, Math.trunc(n));
}

/**
 * Create the battlefield token used by incubate.
 */
export function createIncubatorToken(tokenId: string, controllerId: string, n: number): any {
  const counterCount = getIncubateCounterCount(n);
  return {
    id: tokenId,
    controller: controllerId,
    owner: controllerId,
    tapped: false,
    summoningSickness: false,
    counters: {
      '+1/+1': counterCount,
    },
    attachments: [],
    modifiers: [],
    isToken: true,
    card: {
      id: tokenId,
      name: 'Incubator Token',
      type_line: 'Artifact — Incubator',
      oracle_text: INCUBATOR_TOKEN.frontFace.ability,
      colors: INCUBATOR_TOKEN.frontFace.colors,
      mana_cost: '',
      cmc: 0,
    },
    basePower: 0,
    baseToughness: 0,
    transformable: true,
    backFace: {
      name: INCUBATOR_TOKEN.backFace.name,
      type_line: 'Artifact Creature — Phyrexian',
      colors: INCUBATOR_TOKEN.backFace.colors,
      power: INCUBATOR_TOKEN.backFace.power,
      toughness: INCUBATOR_TOKEN.backFace.toughness,
    },
  };
}

/**
 * Check whether an incubator token can transform.
 */
export function canTransformIncubator(
  permanent: { card?: { type_line?: string }; transformed?: boolean },
  manaAvailable: number,
): boolean {
  const typeLine = String(permanent.card?.type_line || '').toLowerCase();
  return typeLine.includes('incubator') && permanent.transformed !== true && manaAvailable >= 2;
}
