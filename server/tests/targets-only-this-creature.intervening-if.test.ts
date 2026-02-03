import { describe, it, expect } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: if that spell targets only this creature', () => {
  const clause = 'if that spell targets only this creature';

  it('returns true when all explicit targets are this creature (refs.stackItem)', () => {
    const ctx = { state: {} } as any;
    const source = { id: 'perm_src' } as any;

    expect(
      evaluateInterveningIfClause(ctx, 'p1', clause, source, {
        stackItem: { targets: ['perm_src'] },
      } as any)
    ).toBe(true);

    // Duplicate entries still count as "only this creature".
    expect(
      evaluateInterveningIfClause(ctx, 'p1', clause, source, {
        stackItem: { targets: [{ id: 'perm_src' }, { id: 'perm_src' }] },
      } as any)
    ).toBe(true);
  });

  it('returns false when there is any other known target', () => {
    const ctx = { state: {} } as any;
    const source = { id: 'perm_src' } as any;

    expect(
      evaluateInterveningIfClause(ctx, 'p1', clause, source, {
        stackItem: { targets: ['perm_src', 'perm_other'] },
      } as any)
    ).toBe(false);

    expect(
      evaluateInterveningIfClause(ctx, 'p1', clause, source, {
        stackItem: { targetId: 'perm_other' },
      } as any)
    ).toBe(false);
  });

  it('returns null when any target is unknown/unstable', () => {
    const ctx = { state: {} } as any;
    const source = { id: 'perm_src' } as any;

    expect(
      evaluateInterveningIfClause(ctx, 'p1', clause, source, {
        stackItem: { targets: ['perm_src', undefined] },
      } as any)
    ).toBe(null);

    expect(
      evaluateInterveningIfClause(ctx, 'p1', clause, source, {
        stackItem: { targets: [{ id: 'perm_src' }, {}] },
      } as any)
    ).toBe(null);

    // Avoid treating String(undefined) === 'undefined' as a real target id.
    expect(
      evaluateInterveningIfClause(ctx, 'p1', clause, source, {
        stackItem: { targets: ['perm_src', 'undefined'] },
      } as any)
    ).toBe(null);
  });
});
