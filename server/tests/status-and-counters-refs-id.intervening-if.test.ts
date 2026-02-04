import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: status/counter templates work via refs-id', () => {
  it('tapped/untapped, token, name, type, chosen color work without sourcePermanent', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [
          {
            id: 'perm_tapped',
            controller: 'p1',
            tapped: true,
            isToken: true,
            chosenColor: 'R',
            card: { name: 'Foo', type_line: 'Enchantment Creature — Human' },
          },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if it is tapped', null as any, { sourcePermanentId: 'perm_tapped' } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if it is untapped', null as any, { sourcePermanentId: 'perm_tapped' } as any)
    ).toBe(false);

    expect(
      evaluateInterveningIfClause(g, 'p1', "if it's a token", null as any, { sourcePermanentId: 'perm_tapped' } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if this creature is named Foo', null as any, { thisCreatureId: 'perm_tapped' } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if this permanent is an enchantment', null as any, { thisPermanentId: 'perm_tapped' } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if you chose red', null as any, { sourcePermanentId: 'perm_tapped' } as any)
    ).toBe(true);
  });

  it('ki counters, battalion, and blocking-a-colored-creature work without sourcePermanent', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [
          { id: 'a1', controller: 'p1', attacking: true, counters: { ki: 3 }, card: { name: 'A1', type_line: 'Creature' } },
          { id: 'a2', controller: 'p1', attacking: true, card: { name: 'A2', type_line: 'Creature' } },
          { id: 'a3', controller: 'p1', attacking: true, card: { name: 'A3', type_line: 'Creature' } },
          { id: 'blocker', controller: 'p1', blocking: ['blocked_red'], card: { name: 'Blocker', type_line: 'Creature' } },
          { id: 'blocked_red', controller: 'p2', card: { name: 'RedGuy', type_line: 'Creature', colors: ['R'] } },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if there are 3 or more ki counters on this creature', null as any, {
        thisCreatureId: 'a1',
      } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if this creature and at least two other creatures are attacking', null as any, {
        thisCreatureId: 'a1',
      } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if it is blocking a red creature', null as any, {
        sourcePermanentId: 'blocker',
      } as any)
    ).toBe(true);
  });
});
