import { describe, it, expect } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe("Intervening-if: 'that player didn't cast ... this turn'", () => {
  it("'that player didn't cast a spell this turn' is deterministic from spell log (or empty/missing)", () => {
    const clause = "if that player didn't cast a spell this turn";

    expect(evaluateInterveningIfClause({ state: {} } as any, 'p1', clause, null as any, { thatPlayerId: 'p2' } as any)).toBe(true);

    const ctx = {
      state: {
        spellsCastThisTurn: [{ casterId: 'p2', card: { name: 'A', type_line: 'Instant' } }],
      },
    } as any;
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, null as any, { thatPlayerId: 'p2' } as any)).toBe(false);
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, null as any, { thatPlayerId: 'p3' } as any)).toBe(true);

    // Missing refs => conservative unknown.
    expect(evaluateInterveningIfClause(ctx, 'p1', clause)).toBe(null);
  });

  it("'that player didn't cast a creature spell this turn' is conservative on unknown type lines", () => {
    const clause = "if that player didn't cast a creature spell this turn";

    const ctxCreature = {
      state: {
        spellsCastThisTurn: [{ casterId: 'p2', card: { name: 'Bear', type_line: 'Creature — Bear' } }],
      },
    } as any;
    expect(evaluateInterveningIfClause(ctxCreature, 'p1', clause, null as any, { thatPlayerId: 'p2' } as any)).toBe(false);

    const ctxNonCreature = {
      state: {
        spellsCastThisTurn: [{ casterId: 'p2', card: { name: 'Bolt', type_line: 'Instant' } }],
      },
    } as any;
    expect(evaluateInterveningIfClause(ctxNonCreature, 'p1', clause, null as any, { thatPlayerId: 'p2' } as any)).toBe(true);

    const ctxUnknown = {
      state: {
        spellsCastThisTurn: [{ casterId: 'p2', card: { name: 'Mystery' } }],
      },
    } as any;
    expect(evaluateInterveningIfClause(ctxUnknown, 'p1', clause, null as any, { thatPlayerId: 'p2' } as any)).toBe(null);

    const ctxMixed = {
      state: {
        spellsCastThisTurn: [{ casterId: 'p2', card: { name: 'Mystery' } }, { casterId: 'p2', card: { name: 'Bear', type_line: 'Creature — Bear' } }],
      },
    } as any;
    expect(evaluateInterveningIfClause(ctxMixed, 'p1', clause, null as any, { thatPlayerId: 'p2' } as any)).toBe(false);
  });
});
