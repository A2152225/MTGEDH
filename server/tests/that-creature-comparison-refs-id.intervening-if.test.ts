import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "that creature" comparisons work via refs-id', () => {
  it('compares that creature vs this creature without sourcePermanent', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [
          { id: 'self', controller: 'p1', card: { name: 'Self', type_line: 'Creature', power: '2', toughness: '2' } },
          { id: 'that', controller: 'p1', card: { name: 'That', type_line: 'Creature', power: '3', toughness: '1' } },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if that creature has greater power or toughness than this creature', null as any, {
        thisCreatureId: 'self',
        thatCreatureId: 'that',
      } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(g, 'p1', "if that creature's power is greater than this creature's", null as any, {
        thisCreatureId: 'self',
        thatCreatureId: 'that',
      } as any)
    ).toBe(true);
  });

  it('returns false when that creature is not greater', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [
          { id: 'self', controller: 'p1', card: { name: 'Self', type_line: 'Creature', power: '4', toughness: '4' } },
          { id: 'that', controller: 'p1', card: { name: 'That', type_line: 'Creature', power: '1', toughness: '1' } },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if that creature has greater power or toughness than this creature', null as any, {
        thisCreatureId: 'self',
        thatCreatureId: 'that',
      } as any)
    ).toBe(false);

    expect(
      evaluateInterveningIfClause(g, 'p1', "if that creature's power is greater than this creature's", null as any, {
        thisCreatureId: 'self',
        thatCreatureId: 'that',
      } as any)
    ).toBe(false);
  });
});
