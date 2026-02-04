import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: modified can resolve perm by refs id', () => {
  it('returns true/false when permanent is found via refs and sourcePermanent is missing', () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 'c1', controller: 'p1', counters: { '+1/+1': 1 }, card: { type_line: 'Creature' } },
          { id: 'c2', controller: 'p1', counters: {}, card: { type_line: 'Creature' } },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if this creature is modified', null as any, {
        thisCreatureId: 'c1',
      } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if it is modified', null as any, {
        thisCreatureId: 'c2',
      } as any)
    ).toBe(false);
  });

  it('returns null when sourcePermanent is missing and refs id cannot be resolved', () => {
    const ctx: any = { state: { battlefield: [] } };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if this creature is modified', null as any, {} as any)).toBe(null);

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if this creature is modified', null as any, {
        thisCreatureId: 'missing',
      } as any)
    ).toBe(null);
  });
});
