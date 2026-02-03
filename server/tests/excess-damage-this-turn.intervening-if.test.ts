import { describe, expect, it } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: excess damage this turn', () => {
  it('that creature was dealt excess damage: returns null when tracking is absent', () => {
    const g: any = { state: { battlefield: [{ id: 'c1', controller: 'p2', card: { type_line: 'Creature' } }] } };
    const refs: any = { thatCreatureId: 'c1' };
    expect(evaluateInterveningIfClause(g, 'p1', 'if that creature was dealt excess damage this turn', { id: 'src' } as any, refs)).toBe(
      null
    );
  });

  it('that creature was dealt excess damage: returns false when tracking exists but id is absent', () => {
    const g: any = {
      state: {
        battlefield: [{ id: 'c1', controller: 'p2', card: { type_line: 'Creature' } }],
        excessDamageThisTurnByCreatureId: {},
      },
    };
    const refs: any = { thatCreatureId: 'c1' };
    expect(evaluateInterveningIfClause(g, 'p1', 'if that creature was dealt excess damage this turn', { id: 'src' } as any, refs)).toBe(
      false
    );
  });

  it('opponent excess damage: returns null when tracking is absent', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [{ id: 'c1', controller: 'p2', card: { type_line: 'Creature' } }],
      },
    };
    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if a creature or planeswalker an opponent controlled was dealt excess damage this turn',
        { id: 'src' } as any
      )
    ).toBe(null);
  });

  it('opponent excess damage: returns false when tracking exists but no opponent permanent is marked', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [{ id: 'c1', controller: 'p2', card: { type_line: 'Creature' } }],
        excessDamageThisTurnByCreatureId: {},
      },
    };
    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if a creature or planeswalker an opponent controlled was dealt excess damage this turn',
        { id: 'src' } as any
      )
    ).toBe(false);
  });

  it('opponent excess damage: returns true when an opponent permanent is marked', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [{ id: 'c1', controller: 'p2', card: { type_line: 'Creature' }, wasDealtExcessDamageThisTurn: true }],
      },
    };
    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if a creature or planeswalker an opponent controlled was dealt excess damage this turn',
        { id: 'src' } as any
      )
    ).toBe(true);
  });
});
