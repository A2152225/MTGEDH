import { describe, expect, it } from 'vitest';

import {
  buildCreateTokenReplayMutations,
  collectReplayMutationsFromAppliedStep,
} from '../src/oracleIRReplayMutations';
import type { GameState, PlayerID } from '../../shared/src';

describe('oracle IR replay mutations', () => {
  it('records mill mutations from applyMillStep replayMutations payload', () => {
    const mutations = collectReplayMutationsFromAppliedStep(
      { kind: 'mill', who: { kind: 'target_player' }, amount: { kind: 'number', value: 2 }, raw: 'mill two' } as any,
      {
        replayMutations: [{ kind: 'mill', playerId: 'p2' as PlayerID, count: 2 }],
      },
      { players: [] } as GameState,
      { controllerId: 'p1' as PlayerID },
    );

    expect(mutations).toEqual([{ kind: 'mill', playerId: 'p2', count: 2 }]);
  });

  it('builds createToken mutations from created token ids on battlefield', () => {
    const state = {
      battlefield: [{
        id: 'token_1',
        controller: 'p1',
        isToken: true,
        basePower: 1,
        baseToughness: 1,
        card: {
          id: 'token_1',
          name: 'Soldier',
          type_line: 'Creature — Soldier',
          colors: ['W'],
          keywords: ['haste'],
        },
      }],
    } as GameState;

    expect(buildCreateTokenReplayMutations(state, ['token_1'])).toEqual([{
      kind: 'createToken',
      controllerId: 'p1',
      tokenData: {
        id: 'token_1',
        name: 'Soldier',
        typeLine: 'Creature — Soldier',
        power: 1,
        toughness: 1,
        colors: ['W'],
        abilities: ['haste'],
        hasHaste: true,
      },
    }]);
  });
});
