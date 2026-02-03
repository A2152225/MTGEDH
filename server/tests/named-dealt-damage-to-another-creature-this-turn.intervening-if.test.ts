import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "if <Name> dealt damage to another creature this turn" (Item 31)', () => {
  it('returns true with positive-only tracker evidence', () => {
    const ctx: any = {
      state: {
        battlefield: [{ id: 'c1', controller: 'p1', card: { name: 'Goblin Test' } }],
        creaturesDamagedByThisCreatureThisTurn: { c1: { v1: true } },
      },
    };

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if Goblin Test dealt damage to another creature this turn', undefined as any, {} as any)
    ).toBe(true);
  });

  it('does not infer false from an empty tracker entry (non-combat damage exists)', () => {
    const ctx: any = {
      state: {
        battlefield: [{ id: 'c1', controller: 'p1', card: { name: 'Goblin Test' } }],
        creaturesDamagedByThisCreatureThisTurn: { c1: {} },
      },
    };

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if Goblin Test dealt damage to another creature this turn', undefined as any, {} as any)
    ).toBe(null);
  });

  it('falls back to explicit boolean flags when present', () => {
    const base: any = { state: { battlefield: [{ id: 'c1', controller: 'p1', card: { name: 'Goblin Test' } }] } };

    (base.state.battlefield[0] as any).dealtDamageToAnotherCreatureThisTurn = true;
    expect(
      evaluateInterveningIfClause(base, 'p1', 'if Goblin Test dealt damage to another creature this turn', undefined as any, {} as any)
    ).toBe(true);

    (base.state.battlefield[0] as any).dealtDamageToAnotherCreatureThisTurn = false;
    expect(
      evaluateInterveningIfClause(base, 'p1', 'if Goblin Test dealt damage to another creature this turn', undefined as any, {} as any)
    ).toBe(false);
  });

  it('returns false when no named permanent is found', () => {
    const ctx: any = { state: { battlefield: [] } };
    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if Goblin Test dealt damage to another creature this turn', undefined as any, {} as any)
    ).toBe(false);
  });

  it('returns null when multiple permanents match the name', () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 'c1', controller: 'p1', card: { name: 'Goblin Test' } },
          { id: 'c2', controller: 'p2', card: { name: 'Goblin Test' } },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if Goblin Test dealt damage to another creature this turn', undefined as any, {} as any)
    ).toBe(null);
  });
});
