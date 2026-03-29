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

export const ENDURE_SPIRIT_TOKEN = {
  name: 'Spirit',
  colors: ['W'],
  typeLine: 'Token Creature — Spirit',
};

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

/**
 * Check whether the controller can choose counters instead of the token.
 */
export function canChooseEndureCounters(n: number, canReceiveCounters: boolean): boolean {
  return n > 0 && canReceiveCounters;
}

/**
 * Check whether the token branch should be used.
 */
export function shouldCreateEndureToken(action: EndureAction): boolean {
  return action.createdToken === true;
}

/**
 * Create the white Spirit token used by endure.
 */
export function createEndureSpiritToken(tokenId: string, controllerId: string, n: number): any {
  const size = Math.max(0, Math.trunc(n));
  return {
    id: tokenId,
    controller: controllerId,
    owner: controllerId,
    tapped: false,
    summoningSickness: true,
    counters: {},
    attachments: [],
    modifiers: [],
    isToken: true,
    basePower: size,
    baseToughness: size,
    card: {
      id: tokenId,
      name: ENDURE_SPIRIT_TOKEN.name,
      type_line: ENDURE_SPIRIT_TOKEN.typeLine,
      oracle_text: '',
      colors: ENDURE_SPIRIT_TOKEN.colors,
      mana_cost: '',
      cmc: 0,
    },
  };
}

/**
 * Return the number of +1/+1 counters or token size created by endure.
 */
export function getEndureValue(action: EndureAction): number {
  return Math.max(0, action.n);
}
