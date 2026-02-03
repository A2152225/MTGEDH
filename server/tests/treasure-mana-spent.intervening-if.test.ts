import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe("Intervening-if: 'if mana from a Treasure was spent to cast it'", () => {
  const clause = 'if mana from a Treasure was spent to cast it';

  it('returns true when deterministic spend is known true', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        manaFromTreasureSpentKnown: true,
        manaFromTreasureSpent: true,
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, {} as any, refs)).toBe(true);
  });

  it('returns false when deterministic spend is known false', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        manaFromTreasureSpentKnown: true,
        manaFromTreasureSpent: false,
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, {} as any, refs)).toBe(false);
  });

  it('returns true for positive-only evidence without known flag', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        manaFromTreasureSpent: true,
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, {} as any, refs)).toBe(true);
  });

  it('returns null for false without known flag (avoid false negatives)', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        manaFromTreasureSpent: false,
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, {} as any, refs)).toBe(null);
  });
});
