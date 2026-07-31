import { describe, expect, it } from 'vitest';

import { buildDiscardEffectReplayMutationsFromCards } from '../src/oracleIRReplayMutations.js';

describe('buildDiscardEffectReplayMutationsFromCards', () => {
  it('attributes discards by discardedByPlayerId, ownerId, then owner', () => {
    const mutations = buildDiscardEffectReplayMutationsFromCards(
      [
        { id: 'a', discardedByPlayerId: 'p1' },
        { id: 'b', ownerId: 'p2' },
        { id: 'c', owner: 'p2' },
        { id: 'd' },
      ],
      'graveyard',
      { fallbackPlayerId: 'p1' },
    );

    expect(mutations).toEqual([
      { kind: 'discardEffect', playerId: 'p1', cardIds: ['a', 'd'], destination: 'graveyard' },
      { kind: 'discardEffect', playerId: 'p2', cardIds: ['b', 'c'], destination: 'graveyard' },
    ]);
  });
});
