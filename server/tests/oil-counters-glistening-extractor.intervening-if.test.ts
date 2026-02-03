import { describe, expect, it } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: oil counters on Glistening Extractor', () => {
  const clause = 'if there are one or more oil counters on Glistening Extractor';

  it('returns null when battlefield is not tracked', () => {
    const g: any = { state: { players: [{ id: 'p1' }] } };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'src' } as any)).toBe(null);
  });

  it('returns null when counters tracking is absent everywhere', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [{ id: 'ge', controller: 'p1', card: { name: 'Glistening Extractor' } }],
      },
    };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'src' } as any)).toBe(null);
  });

  it('returns true when counters tracking exists and Extractor has oil > 0', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [
          { id: 'tracker', controller: 'p1', card: { name: 'Tracker Permanent' }, counters: {} },
          { id: 'ge', controller: 'p1', card: { name: 'Glistening Extractor' }, counters: { oil: 1 } },
        ],
      },
    };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'src' } as any)).toBe(true);
  });

  it('returns false when counters tracking exists and Extractor has oil = 0', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [
          { id: 'tracker', controller: 'p1', card: { name: 'Tracker Permanent' }, counters: {} },
          { id: 'ge', controller: 'p1', card: { name: 'Glistening Extractor' }, counters: {} },
        ],
      },
    };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'src' } as any)).toBe(false);
  });

  it('returns false when counters tracking exists but Extractor omits counters object', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [
          { id: 'tracker', controller: 'p1', card: { name: 'Tracker Permanent' }, counters: {} },
          { id: 'ge', controller: 'p1', card: { name: 'Glistening Extractor' } },
        ],
      },
    };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'src' } as any)).toBe(false);
  });
});
