import { describe, it, expect } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: if one or more players being attacked are poisoned', () => {
  const clause = 'if one or more players being attacked are poisoned';

  it('prefers attackedDefendingPlayersThisCombatByPlayer tracking', () => {
    const ctxTrue = {
      state: {
        poisonCounters: { p2: 1 },
        attackedDefendingPlayersThisCombatByPlayer: {
          p1: ['p2'],
        },
      },
    } as any;
    expect(evaluateInterveningIfClause(ctxTrue, 'p1', clause)).toBe(true);

    const ctxFalse = {
      state: {
        poisonCounters: { p2: 0 },
        attackedDefendingPlayersThisCombatByPlayer: {
          p1: ['p2'],
        },
      },
    } as any;
    expect(evaluateInterveningIfClause(ctxFalse, 'p1', clause)).toBe(false);
  });

  it('returns null when attackedDefendingPlayersThisCombatByPlayer is present but has no lists', () => {
    const ctx = {
      state: {
        poisonCounters: { p2: 10 },
        attackedDefendingPlayersThisCombatByPlayer: {},
      },
    } as any;
    expect(evaluateInterveningIfClause(ctx, 'p1', clause)).toBe(null);
  });

  it('fallback resolves planeswalker/battle targets to their controller', () => {
    const ctx = {
      state: {
        poisonCounters: { p2: 2 },
        battlefield: [
          { id: 'atk1', card: { type_line: 'Creature' }, attacking: 'perm_pw1' },
          { id: 'perm_pw1', card: { type_line: 'Planeswalker' }, controller: 'p2' },
        ],
      },
    } as any;

    expect(evaluateInterveningIfClause(ctx, 'p1', clause)).toBe(true);
  });

  it('fallback is conservative when planeswalker/battle controller is unknown', () => {
    const ctx = {
      state: {
        poisonCounters: { p2: 2 },
        battlefield: [{ id: 'atk1', card: { type_line: 'Creature' }, attacking: 'perm_pw1' }],
      },
    } as any;

    expect(evaluateInterveningIfClause(ctx, 'p1', clause)).toBe(null);
  });
});
