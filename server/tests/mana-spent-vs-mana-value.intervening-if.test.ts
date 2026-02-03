import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: mana spent vs mana value', () => {
  it("uses manaSpentBreakdown when manaSpentTotal is missing", () => {
    const ctx: any = { state: {} };

    const stackItem: any = {
      manaSpentBreakdown: { blue: 1 },
      card: { manaValue: 2 },
    };

    expect(
      evaluateInterveningIfClause(
        ctx,
        'p1',
        'if the amount of mana spent to cast it was less than its mana value',
        {} as any,
        { stackItem } as any
      )
    ).toBe(true);
  });

  it('returns false when spent is not less than mana value', () => {
    const ctx: any = { state: {} };

    const stackItem: any = {
      manaSpentBreakdown: { blue: 2 },
      card: { manaValue: 2 },
    };

    expect(
      evaluateInterveningIfClause(
        ctx,
        'p1',
        'if the amount of mana spent to cast it was less than its mana value',
        {} as any,
        { stackItem } as any
      )
    ).toBe(false);
  });
});
