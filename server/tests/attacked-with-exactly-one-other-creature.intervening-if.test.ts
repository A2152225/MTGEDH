import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: if you attacked with exactly one other creature this combat', () => {
  const clause = 'if you attacked with exactly one other creature this combat';

  it('returns true when exactly one other attacker exists (refs id, no sourcePermanent)', () => {
    const ctx: any = {
      state: {
        attackersDeclaredThisCombatByPlayer: {
          p1: [{ id: 'src' }, { id: 'other' }],
        },
      },
    };

    expect(
      evaluateInterveningIfClause(ctx, 'p1', clause, null as any, {
        thisCreatureId: 'src',
      } as any)
    ).toBe(true);
  });

  it('returns false when there are zero or two+ other attackers', () => {
    const ctx0: any = {
      state: {
        attackersDeclaredThisCombatByPlayer: {
          p1: [{ id: 'src' }],
        },
      },
    };

    expect(
      evaluateInterveningIfClause(ctx0, 'p1', clause, null as any, {
        thisCreatureId: 'src',
      } as any)
    ).toBe(false);

    const ctx2: any = {
      state: {
        attackersDeclaredThisCombatByPlayer: {
          p1: [{ id: 'src' }, { id: 'o1' }, { id: 'o2' }],
        },
      },
    };

    expect(
      evaluateInterveningIfClause(ctx2, 'p1', clause, null as any, {
        thisCreatureId: 'src',
      } as any)
    ).toBe(false);
  });

  it('returns null when per-combat tracking is unavailable', () => {
    const ctx: any = { state: {} };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', clause, null as any, {
        thisCreatureId: 'src',
      } as any)
    ).toBe(null);
  });
});
