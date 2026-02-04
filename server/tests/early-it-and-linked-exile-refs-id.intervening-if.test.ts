import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: early "it" templates work via refs-id', () => {
  it('renown/historic/creature/on-battlefield work without sourcePermanent', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [
          {
            id: 'self',
            controller: 'p1',
            renowned: true,
            card: { name: 'Self', type_line: 'Legendary Artifact Creature — Human' },
          },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(g, 'p1', "if it's renowned", null as any, { thisCreatureId: 'self' } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(g, 'p1', "if it's not renowned", null as any, { thisCreatureId: 'self' } as any)
    ).toBe(false);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if it was historic', null as any, { thisPermanentId: 'self' } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(g, 'p1', "if it's a creature", null as any, { thisPermanentId: 'self' } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(g, 'p1', "if it's on the battlefield", null as any, { thisId: 'self' } as any)
    ).toBe(true);
  });

  it('"a card is exiled with it" can be proven true via exile-zone tags without sourcePermanent', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [{ id: 'art1', controller: 'p1', card: { name: 'Art', type_line: 'Artifact' } }],
        zones: {
          p1: {
            exile: [{ id: 'ex1', exiledWithSourceId: 'art1' }],
          },
        },
      },
    };

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if a card is exiled with it', null as any, { sourcePermanentId: 'art1' } as any)
    ).toBe(true);
  });
});
