import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "if <Name> is in exile with an <counter> counter on it" (Item 40)', () => {
  const p1 = 'p1';
  const p2 = 'p2';

  function mkCtx(zones: any, battlefield: any[] = []) {
    return {
      state: {
        players: [{ id: p1 }, { id: p2 }],
        zones,
        battlefield,
      },
    } as any;
  }

  const clause = 'if The Thing is in exile with an oil counter on it';

  it('returns null when exile is not fully tracked and no matches are found', () => {
    const ctx = mkCtx({
      [p1]: { exile: [] },
      // p2 exile missing => not fully tracked
      [p2]: {},
    });

    expect(evaluateInterveningIfClause(ctx, p1, clause)).toBe(null);
  });

  it('returns false when exile is fully tracked and no matches are found', () => {
    const ctx = mkCtx({
      [p1]: { exile: [] },
      [p2]: { exile: [] },
    });

    expect(evaluateInterveningIfClause(ctx, p1, clause)).toBe(false);
  });

  it('returns true when any matching exiled object has the counter', () => {
    const ctx = mkCtx({
      [p1]: {
        exile: [{ id: 'e1', card: { name: 'The Thing' }, counters: { oil: 1 } }],
      },
      [p2]: { exile: [] },
    });

    expect(evaluateInterveningIfClause(ctx, p1, clause)).toBe(true);
  });

  it('returns false when matching objects have counters tracked and none have the counter', () => {
    const ctx = mkCtx({
      [p1]: {
        exile: [{ id: 'e1', card: { name: 'The Thing' }, counters: { oil: 0 } }],
      },
      [p2]: { exile: [] },
    });

    expect(evaluateInterveningIfClause(ctx, p1, clause)).toBe(false);
  });

  it('returns null when matching objects omit counters and there is no evidence counters tracking exists', () => {
    const ctx = mkCtx({
      [p1]: {
        exile: [{ id: 'e1', card: { name: 'The Thing' } }],
      },
      [p2]: { exile: [] },
    });

    expect(evaluateInterveningIfClause(ctx, p1, clause)).toBe(null);
  });

  it('returns false when matching objects omit counters but counters tracking exists elsewhere', () => {
    const ctx = mkCtx(
      {
        [p1]: {
          exile: [{ id: 'e1', card: { name: 'The Thing' } }],
        },
        [p2]: { exile: [] },
      },
      // Evidence counters tracking exists on battlefield.
      [{ id: 'b1', card: { name: 'Other' }, counters: {} }]
    );

    expect(evaluateInterveningIfClause(ctx, p1, clause)).toBe(false);
  });

  it('uses refs-provided explicit exile id when provided', () => {
    const ctx = mkCtx({
      [p1]: {
        exile: [
          { id: 'e1', card: { name: 'The Thing' }, counters: { oil: 0 } },
          { id: 'e2', card: { name: 'The Thing' }, counters: { oil: 2 } },
        ],
      },
      [p2]: { exile: [] },
    });

    expect(evaluateInterveningIfClause(ctx, p1, clause, undefined as any, { exiledCardId: 'e1' } as any)).toBe(false);
    expect(evaluateInterveningIfClause(ctx, p1, clause, undefined as any, { exiledCardId: 'e2' } as any)).toBe(true);
  });
});
