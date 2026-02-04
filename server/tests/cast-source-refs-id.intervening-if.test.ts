import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: cast-source templates work via refs-id', () => {
  it('"if you cast it" and "from your hand" work without sourcePermanent', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [
          {
            id: 'perm_hand',
            controller: 'p1',
            wasCast: true,
            castFromHand: true,
            castSourceZone: 'hand',
            card: { name: 'Perm', type_line: 'Creature' },
          },
        ],
      },
    };

    expect(evaluateInterveningIfClause(g, 'p1', 'if you cast it', null as any, { thisPermanentId: 'perm_hand' } as any)).toBe(true);
    expect(
      evaluateInterveningIfClause(g, 'p1', 'if you cast it from your hand', null as any, { thisPermanentId: 'perm_hand' } as any)
    ).toBe(true);
    expect(
      evaluateInterveningIfClause(g, 'p1', "if you didn't cast it from your hand", null as any, { thisPermanentId: 'perm_hand' } as any)
    ).toBe(false);
  });

  it('graveyard cast/entry templates work without sourcePermanent', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [
          {
            id: 'perm_gy',
            controller: 'p1',
            enteredFromZone: 'graveyard',
            castSourceZone: 'graveyard',
            card: { name: 'PermGY', type_line: 'Creature' },
          },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if it entered from your graveyard or you cast it from your graveyard',
        null as any,
        { thisCreatureId: 'perm_gy' } as any
      )
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(g, 'p1', 'if it was cast from your graveyard', null as any, { thisCreatureId: 'perm_gy' } as any)
    ).toBe(true);
  });
});
