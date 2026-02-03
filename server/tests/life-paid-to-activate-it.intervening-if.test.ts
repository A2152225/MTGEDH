import { describe, it, expect } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: if life was paid to activate it', () => {
  const clause = 'if life was paid to activate it';

  it('uses explicit refs boolean when provided', () => {
    const ctx = { state: {} } as any;
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, null as any, { lifeWasPaidToActivateIt: true } as any)).toBe(true);
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, null as any, { lifeWasPaidToActivateIt: false } as any)).toBe(false);
  });

  it('returns true when the triggering stack item cost explicitly requires paying life', () => {
    const ctx = { state: {} } as any;

    expect(
      evaluateInterveningIfClause(
        ctx,
        'p1',
        clause,
        { id: 'src' } as any,
        { stackItem: { type: 'ability', description: 'Pay 2 life: Draw a card.' } } as any
      )
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(
        ctx,
        'p1',
        clause,
        { id: 'src' } as any,
        { stackItem: { type: 'ability', description: '{T}, Pay X life: Draw X cards.' } } as any
      )
    ).toBe(true);
  });

  it('stays conservative (null) when paying life is optional via an "or" cost', () => {
    const ctx = { state: {} } as any;

    expect(
      evaluateInterveningIfClause(
        ctx,
        'p1',
        clause,
        { id: 'src' } as any,
        { stackItem: { type: 'ability', description: 'Pay 2 life or {B}: Draw a card.' } } as any
      )
    ).toBe(null);
  });
});
