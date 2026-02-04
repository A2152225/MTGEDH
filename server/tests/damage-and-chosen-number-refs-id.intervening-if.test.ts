import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: damage + chosen-number templates work via refs-id', () => {
  it('damage-to-it and dealt-damage-to-opponent work without sourcePermanent', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [
          { id: 'self', controller: 'p1', damageThisTurn: 2, card: { name: 'Self', type_line: 'Creature' } },
        ],
        creaturesThatDealtDamageToPlayer: {
          p2: {
            self: true,
          },
        },
      },
    };

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if this creature was dealt damage this turn', null as any, { thisCreatureId: 'self' } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if 3 or more damage was dealt to it this turn', null as any, { thisCreatureId: 'self' } as any)
    ).toBe(false);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if it dealt damage to an opponent this turn', null as any, { thisCreatureId: 'self' } as any)
    ).toBe(true);
  });

  it('chosen-number power/toughness checks work without sourcePermanent', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [
          { id: 'src', controller: 'p1', chosenNumber: 2, card: { name: 'Src', type_line: 'Enchantment' } },
          { id: 'c1', controller: 'p1', card: { name: 'C1', type_line: 'Creature', power: '2', toughness: '3' } },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if any of those creatures have power or toughness equal to the chosen number', null as any, {
        sourcePermanentId: 'src',
        thoseCreatureIds: ['c1'],
      } as any)
    ).toBe(true);
  });
});
