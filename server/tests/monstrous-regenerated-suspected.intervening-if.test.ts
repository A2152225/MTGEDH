import { describe, expect, it } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: this creature is monstrous / regenerated / suspected', () => {
  it('monstrous: returns null when sourcePermanent missing', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', 'if this creature is monstrous')).toBe(null);
  });

  it('monstrous: reads isMonstrous boolean when present', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', 'if this creature is monstrous', { id: 'c1', isMonstrous: true } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', 'if this creature is monstrous', { id: 'c1', monstrous: false } as any)).toBe(false);
  });

  it('suspected: reads isSuspected/suspected boolean when present', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', 'if this creature is suspected', { id: 'c1', isSuspected: true } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', 'if this creature is suspected', { id: 'c1', suspected: false } as any)).toBe(false);
  });

  it('suspected: returns null when no suspected flag exists', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', 'if this creature is suspected', { id: 'c1' } as any)).toBe(null);
  });

  it('regeneratedThisTurn: can use explicit refs boolean even if sourcePermanent missing', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', 'if this creature regenerated this turn', undefined, { regeneratedThisTurn: true } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', 'if this creature regenerated this turn', undefined, { wasRegeneratedThisTurn: false } as any)).toBe(false);
  });

  it('regeneratedThisTurn: uses sourcePermanent boolean when present', () => {
    const g: any = { state: {} };
    expect(
      evaluateInterveningIfClause(g, 'p1', 'if this creature regenerated this turn', { id: 'c1', regeneratedThisTurn: true } as any)
    ).toBe(true);
    expect(
      evaluateInterveningIfClause(g, 'p1', 'if this creature regenerated this turn', { id: 'c1', wasRegeneratedThisTurn: false } as any)
    ).toBe(false);
  });

  it('regeneratedThisTurn: returns null when no explicit evidence exists', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', 'if this creature regenerated this turn', { id: 'c1' } as any)).toBe(null);
  });
});
