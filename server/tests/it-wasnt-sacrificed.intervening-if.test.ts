import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe("Intervening-if: \"if it wasn't sacrificed\" (Item 43)", () => {
  const p1 = 'p1';

  function mkCtx(): any {
    return { state: { players: [{ id: p1 }], battlefield: [] } };
  }

  it('returns null when no refs evidence is provided', () => {
    const ctx = mkCtx();
    expect(evaluateInterveningIfClause(ctx as any, p1, "if it wasn't sacrificed")).toBe(null);
  });

  it('inverts refs.wasSacrificed', () => {
    const ctx = mkCtx();
    expect(evaluateInterveningIfClause(ctx as any, p1, "if it wasn't sacrificed", undefined as any, { wasSacrificed: true } as any)).toBe(
      false
    );
    expect(
      evaluateInterveningIfClause(ctx as any, p1, "if it wasn't sacrificed", undefined as any, { wasSacrificed: false } as any)
    ).toBe(true);
  });

  it('accepts alternative refs keys', () => {
    const ctx = mkCtx();

    expect(
      evaluateInterveningIfClause(ctx as any, p1, "if it wasn't sacrificed", undefined as any, { itWasSacrificed: true } as any)
    ).toBe(false);
    expect(
      evaluateInterveningIfClause(ctx as any, p1, "if it wasn't sacrificed", undefined as any, { thatPermanentWasSacrificed: false } as any)
    ).toBe(true);
  });

  it('supports straight apostrophe variants in the clause text', () => {
    const ctx = mkCtx();
    expect(
      evaluateInterveningIfClause(ctx as any, p1, "if it wasnt sacrificed", undefined as any, { wasSacrificed: false } as any)
    ).toBe(true);
  });
});
