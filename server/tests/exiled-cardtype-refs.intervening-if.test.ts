import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: exiled card linkage prefers refs-id', () => {
  it('"if it shares a card type with the exiled card" works without sourcePermanent via refs.sourcePermanentId', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [{ id: 'perm_src', controller: 'p1', card: { name: 'Source', type_line: 'Artifact' } }],
        zones: {
          p1: {
            exile: [{ id: 'card_exiled', type_line: 'Creature — Elf', exiledWithSourceId: 'perm_src' }],
          },
        },
      },
    };

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if it shares a card type with the exiled card', null as any, {
        sourcePermanentId: 'perm_src',
        stackItem: { card: { type_line: 'Creature — Human' } },
      } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if it shares a card type with the exiled card', null as any, {
        sourcePermanentId: 'perm_src',
        stackItem: { card: { type_line: 'Instant' } },
      } as any)
    ).toBe(false);
  });

  it('returns null when the linked exiled card cannot be found', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [{ id: 'perm_src', controller: 'p1', card: { name: 'Source', type_line: 'Artifact' } }],
        zones: { p1: { exile: [] } },
      },
    };

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if it shares a card type with the exiled card', null as any, {
        sourcePermanentId: 'perm_src',
        stackItem: { card: { type_line: 'Creature' } },
      } as any)
    ).toBe(null);
  });
});
