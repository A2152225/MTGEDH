import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "if two or more players have lost the game" (Item 14)', () => {
  it('uses explicit lost-count fields when present', () => {
    expect(evaluateInterveningIfClause({ state: { playersLostCount: 2 } } as any, 'p1', 'if two or more players have lost the game')).toBe(true);
    expect(evaluateInterveningIfClause({ state: { playersLostCount: 1 } } as any, 'p1', 'if two or more players have lost the game')).toBe(false);
  });

  it('uses ctx.inactive set size when provided', () => {
    const ctx: any = { state: {}, inactive: new Set(['p2', 'p3']) };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if two or more players have lost the game')).toBe(true);
  });

  it('falls back to counting loss flags on state.players', () => {
    const ctx: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2', hasLost: true }, { id: 'p3', eliminated: true }, { id: 'p4' }],
      },
    };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if two or more players have lost the game')).toBe(true);
  });

  it('returns null when no authoritative loss evidence exists', () => {
    const ctx: any = { state: {} };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if two or more players have lost the game')).toBe(null);
  });
});
