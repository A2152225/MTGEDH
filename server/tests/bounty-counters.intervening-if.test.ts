import { describe, expect, it } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: bounty counters (opponents control none)', () => {
  const clause = 'if your opponents control no permanents with bounty counters on them';

  it('returns null when battlefield is not tracked', () => {
    const g: any = { state: { players: [{ id: 'p1' }, { id: 'p2' }] } };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'src' } as any)).toBe(null);
  });

  it('returns null when counters tracking is absent everywhere', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [{ id: 'oppPerm', controller: 'p2', card: { name: 'Opponent Permanent' } }],
      },
    };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'src' } as any)).toBe(null);
  });

  it('returns true when counters tracking exists and no opponent has bounty counters', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [
          { id: 'myPerm', controller: 'p1', card: { name: 'Mine' }, counters: {} },
          { id: 'oppPerm', controller: 'p2', card: { name: 'Opponent Permanent' } },
        ],
      },
    };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'src' } as any)).toBe(true);
  });

  it('returns false when an opponent controls a permanent with a bounty counter', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [
          { id: 'myPerm', controller: 'p1', card: { name: 'Mine' }, counters: {} },
          { id: 'oppPerm', controller: 'p2', card: { name: 'Opponent Permanent' }, counters: { bounty: 1 } },
        ],
      },
    };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'src' } as any)).toBe(false);
  });
});
