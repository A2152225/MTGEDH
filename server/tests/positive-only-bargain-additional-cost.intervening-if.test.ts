import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: positive-only bargain + additional cost', () => {
  it("'if it was bargained' is deterministic only when bargainResolved is true", () => {
    const ctx: any = { state: {} };

    const resolvedFalse: any = { bargainResolved: true, wasBargained: false };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if it was bargained', resolvedFalse, {} as any)).toBe(false);

    const unresolvedFalse: any = { wasBargained: false };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if it was bargained', unresolvedFalse, {} as any)).toBe(null);

    const unresolvedTrue: any = { wasBargained: true };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if it was bargained', unresolvedTrue, {} as any)).toBe(true);
  });

  it("'if its additional cost was paid' is positive-only", () => {
    const ctx: any = { state: {} };

    const stackItemTrue: any = { additionalCostWasPaid: true };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if its additional cost was paid', {} as any, { stackItem: stackItemTrue } as any)
    ).toBe(true);

    const stackItemFalse: any = { additionalCostWasPaid: false };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if its additional cost was paid', {} as any, { stackItem: stackItemFalse } as any)
    ).toBe(null);

    const noMetadata: any = {};
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if its additional cost was paid', {} as any, { stackItem: noMetadata } as any)).toBe(null);
  });
});
