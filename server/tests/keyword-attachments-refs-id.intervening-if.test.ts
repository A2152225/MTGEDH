import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: keyword/attachment checks can resolve perm by refs id', () => {
  it('evaluates keywords via refs id when sourcePermanent is missing', () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 'c1', controller: 'p1', card: { type_line: 'Creature', oracle_text: 'Defender' } },
          { id: 'c2', controller: 'p1', card: { type_line: 'Creature', oracle_text: 'First strike' } },
          { id: 'c3', controller: 'p1', card: { type_line: 'Creature', oracle_text: '' }, counters: { decayed: 1 } },
          { id: 'c4', controller: 'p1', card: { type_line: 'Creature', oracle_text: '' }, counters: { '+1/+1': 1 } },
          { id: 'c5', controller: 'p1', card: { type_line: 'Creature', oracle_text: '' }, counters: { '-1/-1': 1 } },
        ],
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if this creature has defender', null as any, { thisCreatureId: 'c1' } as any)).toBe(
      true
    );

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if it has first strike', null as any, { thisCreatureId: 'c2' } as any)).toBe(true);

    expect(evaluateInterveningIfClause(ctx, 'p1', "if it didn't have decayed", null as any, { thisCreatureId: 'c3' } as any)).toBe(false);

    expect(
      evaluateInterveningIfClause(ctx, 'p1', "if it doesn't have first strike", null as any, { thisCreatureId: 'c2' } as any)
    ).toBe(false);

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if it has a +1/+1 counter on it', null as any, { thisCreatureId: 'c4' } as any)
    ).toBe(true);

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if it had a -1/-1 counter on it', null as any, { thisCreatureId: 'c5' } as any)).toBe(
      true
    );
  });

  it('evaluates equipped/enchanted via refs id when sourcePermanent is missing', () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 'eq', controller: 'p1', isEquipped: true, card: { type_line: 'Creature' } },
          { id: 'ench', controller: 'p1', attachments: ['a1', 'a2'], card: { type_line: 'Creature' } },
          { id: 'a1', controller: 'p1', card: { type_line: 'Enchantment — Aura' } },
          { id: 'a2', controller: 'p1', card: { type_line: 'Enchantment — Aura' } },
          { id: 'plain', controller: 'p1', attachments: [], card: { type_line: 'Creature' } },
        ],
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if this creature is equipped', null as any, { thisCreatureId: 'eq' } as any)).toBe(true);

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if this creature is enchanted', null as any, { thisCreatureId: 'ench' } as any)).toBe(true);

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if this creature is enchanted by two or more auras', null as any, {
        thisCreatureId: 'ench',
      } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if this creature is enchanted', null as any, { thisCreatureId: 'plain' } as any)
    ).toBe(false);
  });

  it('returns null when sourcePermanent is missing and refs id cannot be resolved', () => {
    const ctx: any = { state: { battlefield: [] } };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if this creature has defender', null as any, {} as any)).toBe(null);
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if this creature is enchanted', null as any, { thisCreatureId: 'nope' } as any)).toBe(
      null
    );
  });
});
