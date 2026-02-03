import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe("Intervening-if: generic snow mana spent to cast it", () => {
  it("'if {S} was spent to cast it' returns false when deterministic spend is known false", () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        snowManaSpentKnown: true,
        snowManaSpent: false,
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if {S} was spent to cast it', {} as any, refs)).toBe(false);
  });

  it("'if {S} was spent to cast it' returns true when deterministic spend is known true", () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        snowManaSpentKnown: true,
        snowManaSpent: true,
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if {S} was spent to cast it', {} as any, refs)).toBe(true);
  });

  it("'if {S}{S} was spent to cast it' returns false when deterministic spend is known false", () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        snowManaSpentKnown: true,
        snowManaSpent: false,
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if {S}{S} was spent to cast it', {} as any, refs)).toBe(false);
  });

  it("'if {S}{S} was spent to cast it' stays conservative when only a lower bound exists", () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        snowManaSpentKnown: true,
        snowManaSpent: true,
        snowManaSpentByColor: { white: 1 },
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if {S}{S} was spent to cast it', {} as any, refs)).toBe(null);
  });

  it("'if snow mana was spent to cast it' returns false when deterministic spend is known false", () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        snowManaSpentKnown: true,
        snowManaSpent: false,
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if snow mana was spent to cast it', {} as any, refs)).toBe(false);
  });

  it("'if snow mana was spent to cast it' returns true when deterministic spend is known true", () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        snowManaSpentKnown: true,
        snowManaSpent: true,
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if snow mana was spent to cast it', {} as any, refs)).toBe(true);
  });
});
