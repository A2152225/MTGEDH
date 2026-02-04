import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: Spellweaver Helix-style exiled-name check works via refs-id', () => {
  it('works without sourcePermanent via refs.sourcePermanentId + exile-zone tags', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [{ id: 'helix', controller: 'p1', card: { name: 'Spellweaver Helix', type_line: 'Artifact' } }],
        zones: {
          p1: {
            exile: [{ id: 'ex1', name: 'Foo', exiledWithSourceId: 'helix' }],
          },
        },
      },
    };

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if it has the same name as one of the cards exiled with this artifact',
        null as any,
        { sourcePermanentId: 'helix', stackItem: { card: { name: 'Foo' } } } as any
      )
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if it has the same name as one of the cards exiled with this artifact',
        null as any,
        { sourcePermanentId: 'helix', stackItem: { card: { name: 'Bar' } } } as any
      )
    ).toBe(false);
  });
});
