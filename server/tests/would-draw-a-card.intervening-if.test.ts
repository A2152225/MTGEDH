import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe("Intervening-if: 'if you would draw a card' (Item 82)", () => {
  it('returns true/false when explicit refs are provided', () => {
    const ctx: any = { state: {} };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if you would draw a card', null as any, { wouldDrawCard: true } as any)).toBe(true);
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if you would draw a card', null as any, { wouldDrawCard: false } as any)).toBe(false);
  });

  it('returns null when refs are missing', () => {
    const ctx: any = { state: {} };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if you would draw a card', null as any, {} as any)).toBe(null);
  });
});
