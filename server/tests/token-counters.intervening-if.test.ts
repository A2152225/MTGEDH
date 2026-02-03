import { describe, expect, it } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: token counters', () => {
  it('returns null when token-counter tracking is absent', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', 'if you have four token counters', { id: 'src' } as any)).toBe(null);
  });

  it('returns false when tracking exists but player has no entry', () => {
    const g: any = { state: { tokenCounters: {} } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if you have four token counters', { id: 'src' } as any)).toBe(false);
  });

  it('returns true when tracked token counters are >= 4', () => {
    const g: any = { state: { tokenCounters: { p1: 4 } } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if you have four token counters', { id: 'src' } as any)).toBe(true);
  });

  it('returns false when tracked token counters are < 4', () => {
    const g: any = { state: { tokenCounterCount: { p1: 3 } } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if you have four token counters', { id: 'src' } as any)).toBe(false);
  });
});
