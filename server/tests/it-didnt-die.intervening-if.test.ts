import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe("Intervening-if: \"if it didn't die\" (Item 42)", () => {
  const p1 = 'p1';
  const clause = "if it didn't die";

  function mkCtx(battlefield: any[] = [], creaturesDiedThisTurnIds?: string[]): any {
    return {
      state: {
        players: [{ id: p1 }],
        battlefield,
        ...(creaturesDiedThisTurnIds ? { creaturesDiedThisTurnIds } : {}),
      },
    };
  }

  it('returns true when refs supplies it id and it is still on the battlefield', () => {
    const ctx = mkCtx([{ id: 'c1', card: { name: 'C' } }], ['other']);
    expect(evaluateInterveningIfClause(ctx as any, p1, clause, undefined as any, { itCreatureId: 'c1' } as any)).toBe(true);
  });

  it('returns false when refs supplies it id and it appears in creaturesDiedThisTurnIds', () => {
    const ctx = mkCtx([], ['c1']);
    expect(evaluateInterveningIfClause(ctx as any, p1, clause, undefined as any, { itPermanentId: 'c1' } as any)).toBe(false);
  });

  it('falls back to refs booleans when tracker evidence is unavailable/ambiguous', () => {
    const ctx = mkCtx([]);
    expect(evaluateInterveningIfClause(ctx as any, p1, clause, undefined as any, { itDied: true } as any)).toBe(false);
    expect(evaluateInterveningIfClause(ctx as any, p1, clause, undefined as any, { itDied: false } as any)).toBe(true);
  });

  it('returns null when no refs are provided and it cannot be resolved', () => {
    const ctx = mkCtx([]);
    expect(evaluateInterveningIfClause(ctx as any, p1, clause)).toBe(null);
  });

  it('returns null when it id is supplied but neither battlefield nor died tracker can confirm', () => {
    const ctx = mkCtx([]);
    expect(evaluateInterveningIfClause(ctx as any, p1, clause, undefined as any, { itPermanentId: 'c1' } as any)).toBe(null);
  });
});
