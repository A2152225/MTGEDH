import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: artifact counters + linked-exile work via refs-id', () => {
  it('artifact counter templates work without sourcePermanent', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [
          { id: 'art1', controller: 'p1', counters: { loyalty: 1, charge: 2 }, card: { name: 'Art', type_line: 'Artifact' } },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if this artifact has loyalty counters on it', null as any, {
        thisPermanentId: 'art1',
      } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if this artifact has 2 or more charge counters on it', null as any, {
        thisPermanentId: 'art1',
      } as any)
    ).toBe(true);
  });

  it('"three or more cards have been exiled with this artifact" works without sourcePermanent', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [{ id: 'art1', controller: 'p1', card: { name: 'Art', type_line: 'Artifact' } }],
        zones: {
          p1: {
            exile: [
              { id: 'c1', exiledWithSourceId: 'art1' },
              { id: 'c2', exiledWithSourceId: 'art1' },
              { id: 'c3', exiledWithSourceId: 'art1' },
            ],
          },
          p2: { exile: [] },
        },
      },
    };

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if three or more cards have been exiled with this artifact', null as any, {
        sourcePermanentId: 'art1',
      } as any)
    ).toBe(true);

    // Below threshold with fully tracked exile => deterministic false.
    const g2: any = JSON.parse(JSON.stringify(g));
    g2.state.zones.p1.exile = [{ id: 'c1', exiledWithSourceId: 'art1' }, { id: 'c2', exiledWithSourceId: 'art1' }];
    expect(
      evaluateInterveningIfClause(g2, 'p1', 'if three or more cards have been exiled with this artifact', null as any, {
        sourcePermanentId: 'art1',
      } as any)
    ).toBe(false);
  });
});
