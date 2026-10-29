import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { getGoadedBy } from '../src/actions/combat';
import { applyGoadToCreatures } from '../src/oracleIRExecutorCreatureStepUtils';

describe('goad expiry is the goader\'s next turn', () => {
  it('stays active on the following opponents\' turns in a four-player game', () => {
    const state = {
      turnNumber: 39,
      turnPlayer: 'p1',
      turnOrder: ['p1', 'p2', 'p3', 'p4'],
      turnDirection: 1,
      players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }],
      battlefield: [{
        id: 'bear',
        controller: 'p2',
        card: { name: 'Bear', type_line: 'Creature — Bear' },
      }],
    };
    const next = applyGoadToCreatures(state as any, ['bear'], 'p1' as PlayerID);
    const bear = (next as any).battlefield[0];
    expect(bear.goadedUntil.p1).toBe(43);
    expect(getGoadedBy(bear, 40)).toContain('p1');
    expect(getGoadedBy(bear, 42)).toContain('p1');
    expect(getGoadedBy(bear, 43)).not.toContain('p1');
  });
});
