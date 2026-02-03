import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "if it had a counter on it" (Item 41)', () => {
  const p1 = 'p1';

  function mkCtx(battlefield: any[] = []): any {
    return { state: { battlefield, players: [{ id: p1 }] } };
  }

  const clause = 'if it had a counter on it';

  it('uses refs snapshots with a counters map deterministically', () => {
    const ctx = mkCtx();

    expect(evaluateInterveningIfClause(ctx, p1, clause, undefined as any, { itPermanent: { counters: { '+1/+1': 1 } } } as any)).toBe(true);
    expect(evaluateInterveningIfClause(ctx, p1, clause, undefined as any, { thatCreature: { counters: { oil: 0 } } } as any)).toBe(false);
  });

  it('falls back to explicit itPermanentId/itCreatureId on the battlefield', () => {
    const ctx = mkCtx([
      { id: 'c1', card: { name: 'C' }, counters: { stun: 2 } },
      { id: 'c2', card: { name: 'D' }, counters: {} },
    ]);

    expect(evaluateInterveningIfClause(ctx, p1, clause, undefined as any, { itPermanentId: 'c1' } as any)).toBe(true);
    expect(evaluateInterveningIfClause(ctx, p1, clause, undefined as any, { itCreatureId: 'c2' } as any)).toBe(false);
  });

  it('prefers sourcePermanent with explicit counters map over unrelated fallback ids', () => {
    const source = { id: 'src', card: { name: 'Src' }, counters: { oil: 1 } } as any;
    const ctx = mkCtx([{ id: 'other', card: { name: 'Other' }, counters: {} }]);

    const refs = { thatCreatureId: 'other' } as any;
    expect(evaluateInterveningIfClause(ctx, p1, clause, source, refs)).toBe(true);
  });

  it('returns null when no counters map exists on the resolved object', () => {
    const ctx = mkCtx([{ id: 'c1', card: { name: 'C' } }]);

    expect(evaluateInterveningIfClause(ctx, p1, clause, undefined as any, { itPermanentId: 'c1' } as any)).toBe(null);
  });
});
