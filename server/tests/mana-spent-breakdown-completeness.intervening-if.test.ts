import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: manaSpentBreakdown completeness inference', () => {
  it("'if {R} was spent to cast it' returns false when total equals known breakdown and red key is missing", () => {
    const ctx: any = { state: {} };
    const source: any = {
      manaSpentTotal: 2,
      manaSpentBreakdown: { blue: 2 },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if {R} was spent to cast it', source, {} as any)).toBe(false);
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if red mana was spent to cast it', source, {} as any)).toBe(false);
  });

  it("'if {R} was spent to cast it' stays conservative when breakdown doesn't sum to total", () => {
    const ctx: any = { state: {} };
    const source: any = {
      manaSpentTotal: 2,
      manaSpentBreakdown: { blue: 1 },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if {R} was spent to cast it', source, {} as any)).toBe(null);
  });

  it("'if {U}{U} was spent to cast it' works with completeness inference", () => {
    const ctx: any = { state: {} };
    const source: any = {
      manaSpentTotal: 2,
      manaSpentBreakdown: { blue: 2 },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if {U}{U} was spent to cast it', source, {} as any)).toBe(true);
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if {R}{R} was spent to cast it', source, {} as any)).toBe(false);
  });

  it("'if N or more colors of mana were spent to cast it' returns false only when complete", () => {
    const ctx: any = { state: {} };

    const completeOneColor: any = {
      manaSpentTotal: 2,
      manaSpentBreakdown: { blue: 2 },
    };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if two or more colors of mana were spent to cast it', completeOneColor, {} as any)
    ).toBe(false);

    const incompleteOneColor: any = {
      manaSpentTotal: 2,
      manaSpentBreakdown: { blue: 1 },
    };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if two or more colors of mana were spent to cast it', incompleteOneColor, {} as any)
    ).toBe(null);

    const completeTwoColors: any = {
      manaSpentTotal: 2,
      manaSpentBreakdown: { blue: 1, red: 1 },
    };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if two or more colors of mana were spent to cast it', completeTwoColors, {} as any)
    ).toBe(true);
  });

  it("'if no colored mana was spent to cast it' infers true when only colorless is accounted", () => {
    const ctx: any = { state: {} };

    const completeColorless: any = {
      manaSpentTotal: 2,
      manaSpentBreakdown: { colorless: 2 },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if no colored mana was spent to cast it', completeColorless, {} as any)).toBe(true);

    const incompleteColorless: any = {
      manaSpentTotal: 2,
      manaSpentBreakdown: { colorless: 1 },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if no colored mana was spent to cast it', incompleteColorless, {} as any)).toBe(null);

    const mixed: any = {
      manaSpentTotal: 2,
      manaSpentBreakdown: { colorless: 1, red: 1 },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if no colored mana was spent to cast it', mixed, {} as any)).toBe(false);
  });

  it("'if at least three mana of the same color was spent to cast it' is deterministic only when complete", () => {
    const ctx: any = { state: {} };

    const completeTrue: any = {
      manaSpentTotal: 3,
      manaSpentBreakdown: { red: 3 },
    };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if at least three mana of the same color was spent to cast it', {}, { stackItem: completeTrue } as any)
    ).toBe(true);

    const completeFalse: any = {
      manaSpentTotal: 3,
      manaSpentBreakdown: { red: 2, colorless: 1 },
    };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if at least three mana of the same color was spent to cast it', {}, { stackItem: completeFalse } as any)
    ).toBe(false);

    const incompleteBelowThreshold: any = {
      manaSpentTotal: 3,
      manaSpentBreakdown: { red: 2 },
    };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if at least three mana of the same color was spent to cast it', {}, { stackItem: incompleteBelowThreshold } as any)
    ).toBe(null);
  });
});
