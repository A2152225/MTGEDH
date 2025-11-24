/**
 * Rule 701.65: Airbend
 * 
 * Certain spells and abilities instruct a player to airbend one or more permanents
 * and/or spells. To do so, that player exiles those objects. For each card exiled
 * this way, for as long as it remains exiled, its owner may cast it by paying {2}
 * rather than paying its mana cost.
 * 
 * Reference: Rule 701.65
 */

export interface AirbendAction {
  readonly type: 'airbend';
  readonly playerId: string;
  readonly objectIds: readonly string[];
}

/**
 * Rule 701.65a: Airbend objects
 */
export function airbend(
  playerId: string,
  objectIds: readonly string[]
): AirbendAction {
  return {
    type: 'airbend',
    playerId,
    objectIds,
  };
}

/**
 * Rule 701.65b: Airbend trigger
 */
export const AIRBEND_ALTERNATE_COST = '{2}';

export function getAirbendAlternateCost(): string {
  return AIRBEND_ALTERNATE_COST;
}

/**
 * Airbended state
 */
export interface AirbendedState {
  readonly cardId: string;
  readonly ownerId: string;
  readonly canCastWithAlternateCost: boolean;
}

export function createAirbendedState(
  cardId: string,
  ownerId: string
): AirbendedState {
  return {
    cardId,
    ownerId,
    canCastWithAlternateCost: true,
  };
}
