import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "it was" clauses can resolve perm by refs id', () => {
  it('handles blocking / declared-attacker checks via refs id', () => {
    const ctx: any = {
      state: {
        battlefield: [{ id: 'c1', controller: 'p1', blocking: false, card: { type_line: 'Creature' } }],
        attackersDeclaredThisCombatByPlayer: { p1: [] },
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', "if it wasn't blocking", null as any, { thisCreatureId: 'c1' } as any)).toBe(true);

    expect(
      evaluateInterveningIfClause(ctx, 'p1', "if it isn't being declared as an attacker", null as any, { thisCreatureId: 'c1' } as any)
    ).toBe(true);

    ctx.state.attackersDeclaredThisCombatByPlayer.p1 = [{ id: 'c1' }];
    expect(
      evaluateInterveningIfClause(ctx, 'p1', "if it isn't being declared as an attacker", null as any, { thisCreatureId: 'c1' } as any)
    ).toBe(false);
  });

  it('handles enchanted/equipped and subtype checks via refs id', () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 'c1', controller: 'p1', attachments: ['a1', 'e1'], card: { type_line: 'Creature — Goblin' } },
          { id: 'a1', controller: 'p1', card: { type_line: 'Enchantment — Aura' } },
          { id: 'e1', controller: 'p1', card: { type_line: 'Artifact — Equipment' } },
        ],
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if it was enchanted or equipped', null as any, { thisCreatureId: 'c1' } as any)).toBe(true);
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if it was a goblin', null as any, { thisCreatureId: 'c1' } as any)).toBe(true);
    expect(evaluateInterveningIfClause(ctx, 'p1', "if it wasn't a goblin", null as any, { thisCreatureId: 'c1' } as any)).toBe(false);
  });

  it('handles power/toughness snapshot checks via refs id', () => {
    const ctx: any = {
      state: {
        battlefield: [{ id: 'c1', controller: 'p1', power: 4, toughness: 2, card: { type_line: 'Creature' } }],
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if its power was 3 or greater', null as any, { thisCreatureId: 'c1' } as any)).toBe(true);
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if its toughness was less than 3', null as any, { thisCreatureId: 'c1' } as any)).toBe(true);
  });

  it('returns null when refs id cannot be resolved', () => {
    const ctx: any = { state: { battlefield: [] } };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if it was equipped', null as any, { thisCreatureId: 'missing' } as any)).toBe(null);
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if its power was 3 or greater', null as any, { thisCreatureId: 'missing' } as any)).toBe(null);
  });
});
