import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "if he/she/it was cast" / "if this <thing> was cast"', () => {
  function mkCtx(): any {
    return { state: { battlefield: [], players: [] } };
  }

  const p1 = 'p1';

  it('returns null when there is no cast provenance evidence', () => {
    const ctx = mkCtx();
    const src = { id: 's1', card: { name: 'X' } } as any;

    expect(evaluateInterveningIfClause(ctx, p1, 'if it was cast', src)).toBe(null);
    expect(evaluateInterveningIfClause(ctx, p1, 'if this spell was cast', src)).toBe(null);
  });

  it('returns true when cast source zone is present as `source` (common stack-item field)', () => {
    const ctx = mkCtx();
    const src = { id: 's1', card: { name: 'X' }, source: 'hand' } as any;

    expect(evaluateInterveningIfClause(ctx, p1, 'if this spell was cast', src)).toBe(true);
  });

  it('returns true when any cast-from flag is present, even if false (presence implies cast happened)', () => {
    const ctx = mkCtx();
    const src = { id: 's1', card: { name: 'X' }, castFromHand: false } as any;

    expect(evaluateInterveningIfClause(ctx, p1, 'if this creature was cast', src)).toBe(true);
  });

  it('returns true when castFromForetell is present', () => {
    const ctx = mkCtx();
    const src = { id: 's1', card: { name: 'X' }, castFromForetell: true } as any;

    expect(evaluateInterveningIfClause(ctx, p1, 'if it was cast', src)).toBe(true);
  });

  it('uses explicit refs.wasCast boolean when provided', () => {
    const ctx = mkCtx();

    expect(evaluateInterveningIfClause(ctx, p1, 'if it was cast', undefined as any, { wasCast: true } as any)).toBe(true);
    expect(evaluateInterveningIfClause(ctx, p1, 'if it was cast', undefined as any, { wasCast: false } as any)).toBe(false);
  });
});
