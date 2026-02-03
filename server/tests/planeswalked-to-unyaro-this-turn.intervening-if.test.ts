import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "if you planeswalked to Unyaro this turn" (Item 13)', () => {
  it('returns false when Planechase is not enabled (NYI treated as disabled)', () => {
    const ctx: any = { state: { houseRules: {} } };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if you planeswalked to Unyaro this turn', undefined as any, {} as any)).toBe(false);
  });

  it('returns true when enabled and tracker includes Unyaro', () => {
    const ctx: any = {
      state: {
        houseRules: { enablePlanechase: true },
        planeswalkedToThisTurn: { p1: ['unyaro'] },
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if you planeswalked to Unyaro this turn', undefined as any, {} as any)).toBe(true);
  });

  it('returns false when enabled and tracker is an empty list', () => {
    const ctx: any = {
      state: {
        houseRules: { enablePlanechase: true },
        planeswalkedToThisTurn: { p1: [] },
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if you planeswalked to Unyaro this turn', undefined as any, {} as any)).toBe(false);
  });

  it('returns null when enabled but the tracker shape is missing', () => {
    const ctx: any = {
      state: {
        houseRules: { enablePlanechase: true },
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if you planeswalked to Unyaro this turn', undefined as any, {} as any)).toBe(null);
  });
});
