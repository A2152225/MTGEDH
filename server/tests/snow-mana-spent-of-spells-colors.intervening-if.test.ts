import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe("Intervening-if: 'if {S} of any of that spell's colors was spent to cast it' (Item 74)", () => {
  const clause = "if {S} of any of that spell's colors was spent to cast it";

  it('returns true when snow mana spent by color shows a positive amount for one of the spells colors', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        card: { colors: ['G', 'U'] },
        snowManaSpentByColor: { g: 1 },
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, {} as any, refs)).toBe(true);
  });

  it('returns null when snow spend breakdown exists but does not prove non-snow (positive-only)', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        card: { colors: ['G'] },
        snowManaSpentByColor: { g: 0 },
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, {} as any, refs)).toBe(null);
  });

  it('returns false for colorless spells (no colors to match)', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        card: { colors: [] },
        snowManaSpentByColor: { c: 1 },
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, {} as any, refs)).toBe(false);
  });

  it('returns true when snowManaColorsSpent contains one of the spells colors', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        card: { colors: ['R'] },
        snowManaColorsSpent: ['R'],
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, {} as any, refs)).toBe(true);
  });

  it('returns false when deterministic spell-color snow spend is explicitly known to be false', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        card: { colors: ['G'] },
        snowManaOfSpellColorsSpentKnown: true,
        snowManaOfSpellColorsSpent: false,
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, {} as any, refs)).toBe(false);
  });

  it('returns true when deterministic spell-color snow spend is explicitly known to be true', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        card: { colors: ['G'] },
        snowManaOfSpellColorsSpentKnown: true,
        snowManaOfSpellColorsSpent: true,
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, {} as any, refs)).toBe(true);
  });
});
