import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

describe('Oracle IR shuffle_zones_into_library', () => {
  it('empties state.zones hand and graveyard before Echo of Eons draws seven', () => {
    const ir = parseOracleTextToIR(
      'Each player shuffles their hand and graveyard into their library, then draws seven cards.',
      'Echo of Eons',
    );
    const steps = ir.abilities?.[0]?.steps || [];
    const p1Hand = [{ id: 'p1_hand_1', name: 'Opt', type_line: 'Instant' }];
    const p1Graveyard = [{ id: 'p1_gy_1', name: 'Shock', type_line: 'Instant' }];
    const p1Library = Array.from({ length: 10 }, (_, index) => ({
      id: `p1_lib_${index}`,
      name: `P1 Library ${index}`,
      type_line: 'Instant',
    }));
    const p2Hand = [{ id: 'p2_hand_1', name: 'Bolt', type_line: 'Instant' }];
    const p2Graveyard = [{ id: 'p2_gy_1', name: 'Counterspell', type_line: 'Instant' }];
    const p2Library = Array.from({ length: 10 }, (_, index) => ({
      id: `p2_lib_${index}`,
      name: `P2 Library ${index}`,
      type_line: 'Instant',
    }));

    const state = {
      players: [
        { id: p1, hand: [...p1Hand], graveyard: [...p1Graveyard], library: [...p1Library] },
        { id: p2, hand: [...p2Hand], graveyard: [...p2Graveyard], library: [...p2Library] },
      ],
      zones: {
        [p1]: {
          hand: [...p1Hand],
          graveyard: [...p1Graveyard],
          library: [...p1Library],
        },
        [p2]: {
          hand: [...p2Hand],
          graveyard: [...p2Graveyard],
          library: [...p2Library],
        },
      },
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: p1,
      sourceId: 'echo_1',
      sourceName: 'Echo of Eons',
    });

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual([
      'shuffle_zones_into_library',
      'draw',
    ]);
    expect((result.state as any).zones?.[p1]?.hand).toHaveLength(7);
    expect((result.state as any).zones?.[p2]?.hand).toHaveLength(7);
    expect((result.state as any).zones?.[p1]?.graveyard).toHaveLength(0);
    expect((result.state as any).zones?.[p2]?.graveyard).toHaveLength(0);
    expect((result.state as any).players.find((entry: any) => entry.id === p1)?.hand).toHaveLength(7);
  });
});
