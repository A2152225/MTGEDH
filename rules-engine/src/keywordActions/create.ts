/**
 * Rule 701.7: Create
 * 
 * To create one or more tokens with certain characteristics, put the specified
 * number of tokens with the specified characteristics onto the battlefield.
 */

export interface CreateAction {
  readonly type: 'create';
  readonly controllerId: string;
  readonly count: number;
  readonly tokenType: string;
  readonly characteristics: Record<string, unknown>;
}

/**
 * Rule 701.7b: Replacement effects and token creation
 * 
 * If a replacement effect applies to a token being created, that effect applies
 * before considering any continuous effects that will modify the characteristics
 * of that token. If a replacement effect applies to a token entering the battlefield,
 * that effect applies after considering any continuous effects.
 */
export function createTokens(
  controllerId: string,
  count: number,
  tokenType: string,
  characteristics: Record<string, unknown> = {}
): CreateAction {
  return {
    type: 'create',
    controllerId,
    count,
    tokenType,
    characteristics,
  };
}
