import { describe, expect, it } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: kicked + was cast (safe defaults)', () => {
  it('"if it was kicked" returns null when untracked', () => {
    const g: any = { state: {} };
    const source: any = { card: { name: 'Test' } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was kicked', source)).toBe(null);
  });

  it('"if it was kicked" respects explicit boolean metadata', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was kicked', { wasKicked: true } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was kicked', { wasKicked: false } as any)).toBe(false);
  });

  it('"if this creature wasn\'t kicked" inverts explicit boolean metadata', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', "if this creature wasn't kicked", { wasKicked: true } as any)).toBe(false);
    expect(evaluateInterveningIfClause(g, 'p1', "if this creature wasn't kicked", { wasKicked: false } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', "if this creature wasn't kicked", { card: { name: 'X' } } as any)).toBe(null);
  });

  it('"if it was cast" returns true when cast provenance is tracked', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was cast', { castSourceZone: 'hand' } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was cast', { source: 'graveyard' } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was cast', { fromZone: 'exile' } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', 'if it was cast', { castFromHand: true } as any)).toBe(true);
  });
});
