import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "if <Name> entered this turn" (Item 36)', () => {
  it('prefers the source permanent when its name matches (avoids ambiguity)', () => {
    const ctx: any = { state: { battlefield: [] } };
    const src: any = { id: 'c1', controller: 'p1', card: { name: 'Elf Test', type_line: 'Creature — Elf', enteredThisTurn: true } };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if Elf Test entered this turn', src, {} as any)).toBe(true);
  });

  it('returns false when no matching permanent exists on the battlefield', () => {
    const ctx: any = { state: { battlefield: [] } };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if Elf Test entered this turn', undefined as any, {} as any)).toBe(false);
  });

  it('returns null when multiple permanents match the name', () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 'c1', controller: 'p1', card: { name: 'Elf Test' } },
          { id: 'c2', controller: 'p2', card: { name: 'Elf Test' } },
        ],
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if Elf Test entered this turn', undefined as any, {} as any)).toBe(null);
  });

  it('uses per-type ETB id trackers when explicit enteredThisTurn is not present', () => {
    const ctx: any = {
      state: {
        battlefield: [{ id: 'c1', controller: 'p1', card: { name: 'Elf Test', type_line: 'Creature — Elf' } }],
        creaturesEnteredBattlefieldThisTurnIdsByController: { p1: { c1: true } },
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if Elf Test entered this turn', undefined as any, {} as any)).toBe(true);
  });

  it("returns false when the tracker exists but has no entry for the controller", () => {
    const ctx: any = {
      state: {
        battlefield: [{ id: 'c1', controller: 'p1', card: { name: 'Elf Test', type_line: 'Creature — Elf' } }],
        creaturesEnteredBattlefieldThisTurnIdsByController: {},
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if Elf Test entered this turn', undefined as any, {} as any)).toBe(false);
  });
});
