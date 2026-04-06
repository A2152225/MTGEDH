import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: color and Treasure mana spend clauses', () => {
  it('returns true when a single colored pip is present in a complete mana breakdown', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        manaSpentTotal: 2,
        manaSpentBreakdown: { red: 1, colorless: 1 },
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if {R} was spent to cast it', {} as any, refs)).toBe(true);
  });

  it('returns false when a single colored pip is absent from a complete mana breakdown', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        manaSpentTotal: 2,
        manaSpentBreakdown: { blue: 1, colorless: 1 },
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if {R} was spent to cast it', {} as any, refs)).toBe(false);
  });

  it('returns true when two matching colored pips are present', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        manaSpentTotal: 2,
        manaSpentBreakdown: { black: 2 },
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if {B}{B} was spent to cast it', {} as any, refs)).toBe(true);
  });

  it('returns false when two matching colored pips are not present in a complete breakdown', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        manaSpentTotal: 2,
        manaSpentBreakdown: { black: 1, colorless: 1 },
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if {B}{B} was spent to cast it', {} as any, refs)).toBe(false);
  });

  it('returns true when colorless mana was not spent in a complete breakdown', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        manaSpentTotal: 2,
        manaSpentBreakdown: { white: 1, blue: 1 },
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', "if {C} wasn't spent to cast it", {} as any, refs)).toBe(true);
  });

  it('returns false when colorless mana was spent', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        manaSpentTotal: 2,
        manaSpentBreakdown: { colorless: 1, blue: 1 },
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', "if {C} wasn't spent to cast it", {} as any, refs)).toBe(false);
  });

  it('returns true when Treasure spend is deterministically known for cast-or-activate clauses', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        manaFromTreasureSpentKnown: true,
        manaFromTreasureSpent: true,
      },
    };

    expect(
      evaluateInterveningIfClause(
        ctx,
        'p1',
        'if mana from a Treasure was spent to cast it or activate it',
        {} as any,
        refs,
      ),
    ).toBe(true);
  });

  it('returns false when Treasure spend is deterministically known false for cast-or-activate clauses', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        manaFromTreasureSpentKnown: true,
        manaFromTreasureSpent: false,
      },
    };

    expect(
      evaluateInterveningIfClause(
        ctx,
        'p1',
        'if mana from a Treasure was spent to cast it or activate it',
        {} as any,
        refs,
      ),
    ).toBe(false);
  });

  it('prefers triggering stack metadata over source permanents with quoted granted text', () => {
    const ctx: any = { state: {} };
    const sourcePermanent: any = {
      id: 'sokrates_1',
      card: {
        name: 'Sokrates, Athenian Teacher',
        oracle_text:
          'Until end of turn, target creature gains "If this creature would deal combat damage to a player, prevent that damage. This creature\'s controller and that player each draw half that many cards, rounded down."',
      },
      manaSpentBreakdown: { blue: 2 },
    };
    const refs: any = {
      stackItem: {
        manaSpentTotal: 2,
        manaSpentBreakdown: { red: 1, colorless: 1 },
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if {R} was spent to cast it', sourcePermanent, refs)).toBe(true);
  });
});