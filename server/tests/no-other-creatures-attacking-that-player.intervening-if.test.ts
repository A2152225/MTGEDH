import { describe, it, expect } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: if no other creatures are attacking that player', () => {
  const clause = 'if no other creatures are attacking that player';

  it('returns true when declared-attacker tracking shows only this attacker', () => {
    const src = { id: 'a1', card: { type_line: 'Creature' }, attacking: 'p2' } as any;
    const ctx = {
      state: {
        battlefield: [src],
        attackersDeclaredThisCombatByPlayer: {
          p1: [{ id: 'a1' }],
        },
      },
    } as any;

    expect(evaluateInterveningIfClause(ctx, 'p1', clause, src, { thatPlayerId: 'p2' } as any)).toBe(true);
  });

  it('uses declared-attacker tracking to decide true/false when multiple attackers exist', () => {
    const src = { id: 'a1', card: { type_line: 'Creature' }, attacking: 'p2' } as any;
    const other = { id: 'a2', card: { type_line: 'Creature' }, attacking: 'p3' } as any;

    const ctxTrue = {
      state: {
        battlefield: [src, other],
        attackersDeclaredThisCombatByPlayer: {
          p1: [{ id: 'a1' }, { id: 'a2' }],
        },
      },
    } as any;
    expect(evaluateInterveningIfClause(ctxTrue, 'p1', clause, src, { thatPlayerId: 'p2' } as any)).toBe(true);

    const otherToSame = { ...other, attacking: 'p2' } as any;
    const ctxFalse = {
      state: {
        battlefield: [src, otherToSame],
        attackersDeclaredThisCombatByPlayer: {
          p1: [{ id: 'a1' }, { id: 'a2' }],
        },
      },
    } as any;
    expect(evaluateInterveningIfClause(ctxFalse, 'p1', clause, src, { thatPlayerId: 'p2' } as any)).toBe(false);
  });

  it('returns null when declared attackers exist but their target is unknown', () => {
    const src = { id: 'a1', card: { type_line: 'Creature' }, attacking: 'p2' } as any;
    const otherUnknown = { id: 'a2', card: { type_line: 'Creature' }, attacking: true } as any;
    const ctx = {
      state: {
        battlefield: [src, otherUnknown],
        attackersDeclaredThisCombatByPlayer: {
          p1: [{ id: 'a1' }, { id: 'a2' }],
        },
      },
    } as any;

    expect(evaluateInterveningIfClause(ctx, 'p1', clause, src, { thatPlayerId: 'p2' } as any)).toBe(null);
  });

  it('falls back to battlefield scan when declared-attacker tracking is absent', () => {
    const src = { id: 'a1', card: { type_line: 'Creature' }, attacking: 'p2' } as any;

    const ctxTrue = {
      state: {
        battlefield: [src, { id: 'a2', card: { type_line: 'Creature' }, attacking: 'p3' }],
      },
    } as any;
    expect(evaluateInterveningIfClause(ctxTrue, 'p1', clause, src, { thatPlayerId: 'p2' } as any)).toBe(true);

    const ctxFalse = {
      state: {
        battlefield: [src, { id: 'a2', card: { type_line: 'Creature' }, attacking: 'p2' }],
      },
    } as any;
    expect(evaluateInterveningIfClause(ctxFalse, 'p1', clause, src, { thatPlayerId: 'p2' } as any)).toBe(false);

    const ctxNull = {
      state: {
        battlefield: [src, { id: 'a2', card: { type_line: 'Creature' }, attacking: true }],
      },
    } as any;
    expect(evaluateInterveningIfClause(ctxNull, 'p1', clause, src, { thatPlayerId: 'p2' } as any)).toBe(null);
  });
});
