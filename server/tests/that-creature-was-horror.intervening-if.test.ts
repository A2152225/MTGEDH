import { describe, expect, it } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: that creature was a Horror', () => {
  const clause = 'if that creature was a Horror';

  it('returns null when no referenced creature is provided', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'src' } as any, {} as any)).toBe(null);
  });

  it('returns true when refs provides a thatCreature snapshot with Horror type_line', () => {
    const g: any = { state: {} };
    const refs: any = { thatCreature: { card: { type_line: 'Creature — Horror' } } };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'src' } as any, refs)).toBe(true);
  });

  it('returns false when refs provides a thatCreature snapshot without Horror', () => {
    const g: any = { state: {} };
    const refs: any = { thatCreature: { card: { type_line: 'Creature — Elf' } } };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'src' } as any, refs)).toBe(false);
  });

  it('returns null when refs provides a thatCreature snapshot but type_line is unknown', () => {
    const g: any = { state: {} };
    const refs: any = { thatCreature: { card: {} } };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'src' } as any, refs)).toBe(null);
  });

  it('falls back to battlefield lookup by thatCreatureId when present', () => {
    const g: any = {
      state: {
        battlefield: [{ id: 'c1', controller: 'p2', card: { name: 'Some Creature', type_line: 'Creature — Horror' } }],
      },
    };
    const refs: any = { thatCreatureId: 'c1' };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'src' } as any, refs)).toBe(true);
  });
});
