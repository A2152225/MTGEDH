import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe("Intervening-if: 'if its additional cost was paid'", () => {
  const clause = 'if its additional cost was paid';

  it('returns true when additional-cost payment is known true', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        additionalCostPaidKnown: true,
        additionalCostPaid: true,
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, {} as any, refs)).toBe(true);
  });

  it('returns false when additional-cost payment is known false', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        additionalCostPaidKnown: true,
        additionalCostPaid: false,
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, {} as any, refs)).toBe(false);
  });

  it('returns true for positive-only evidence without known flag', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        additionalCostPaid: true,
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, {} as any, refs)).toBe(true);
  });

  it('returns null for false without known flag (avoid false negatives)', () => {
    const ctx: any = { state: {} };
    const refs: any = {
      stackItem: {
        additionalCostPaid: false,
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, {} as any, refs)).toBe(null);
  });
});
