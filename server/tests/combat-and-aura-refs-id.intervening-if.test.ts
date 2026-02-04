import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause, evaluateInterveningIfClauseDetailed } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: refs-id fallback for aura + combat-state clauses', () => {
  it('evaluates aura attachedTo clauses using refs.sourcePermanentId when sourcePermanent is missing', () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 'auraEq', controller: 'p1', attachedTo: 'eq1', card: { type_line: 'Enchantment — Aura' } },
          { id: 'auraC', controller: 'p1', attachedTo: 'c1', card: { type_line: 'Enchantment — Aura' } },
          { id: 'eq1', controller: 'p1', attachedTo: 'c1', card: { type_line: 'Artifact — Equipment' } },
          { id: 'c1', controller: 'p1', tapped: false, card: { type_line: 'Creature' } },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if enchanted Equipment is attached to a creature', null as any, {
        sourcePermanentId: 'auraEq',
      } as any)
    ).toBe(true);

    const detailed = evaluateInterveningIfClauseDetailed(ctx, 'p1', 'if enchanted creature is untapped', null as any, {
      sourcePermanentId: 'auraC',
    } as any);
    expect(detailed.matched).toBe(true);
    expect((detailed as any).fallback).not.toBe(true);
    expect(detailed.value).toBe(true);
  });

  it('evaluates combat-state clauses via refs.thisCreatureId when sourcePermanent is missing', () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 'c1', controller: 'p1', attacking: 'p2', tapped: true, attachments: ['e1'], card: { type_line: 'Creature — Goblin', name: 'Solo' } },
          { id: 'e1', controller: 'p1', card: { type_line: 'Artifact — Equipment' } },
        ],
        attackersDeclaredThisCombatByPlayer: { p1: [{ id: 'c1' }] },
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', "if it's equipped", null as any, { thisCreatureId: 'c1' } as any)).toBe(true);
    expect(evaluateInterveningIfClause(ctx, 'p1', "if it's tapped", null as any, { thisCreatureId: 'c1' } as any)).toBe(true);
    expect(evaluateInterveningIfClause(ctx, 'p1', "if it's attacking", null as any, { thisCreatureId: 'c1' } as any)).toBe(true);
    expect(
      evaluateInterveningIfClause(ctx, 'p1', "if it isn't being declared as an attacker", null as any, { thisCreatureId: 'c1' } as any)
    ).toBe(false);
    expect(evaluateInterveningIfClause(ctx, 'p1', "if it's enchanted or equipped", null as any, { thisCreatureId: 'c1' } as any)).toBe(true);
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if it was a goblin', null as any, { thisCreatureId: 'c1' } as any)).toBe(true);
  });

  it('evaluates Guardian Project-style uniqueness via refs id when sourcePermanent is missing', () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 'c1', controller: 'p1', card: { type_line: 'Creature', name: 'Copycat' } },
          { id: 'c2', controller: 'p1', card: { type_line: 'Creature', name: 'Copycat' } },
        ],
        zones: { p1: { graveyard: [] } },
      },
    };

    expect(
      evaluateInterveningIfClause(
        ctx,
        'p1',
        "if it doesn't have the same name as another creature you control or a creature card in your graveyard",
        null as any,
        { thisCreatureId: 'c1' } as any
      )
    ).toBe(false);

    ctx.state.battlefield = [{ id: 'c1', controller: 'p1', card: { type_line: 'Creature', name: 'Unique' } }];

    expect(
      evaluateInterveningIfClause(
        ctx,
        'p1',
        "if it doesn't have the same name as another creature you control or a creature card in your graveyard",
        null as any,
        { thisCreatureId: 'c1' } as any
      )
    ).toBe(true);
  });

  it("evaluates 'it's attacking alone' using refs.thisCreatureId when sourcePermanent is missing", () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 'c1', controller: 'p1', attacking: 'p2', card: { type_line: 'Creature', name: 'Solo' } },
          { id: 'c2', controller: 'p1', attacking: null, card: { type_line: 'Creature', name: 'Buddy' } },
        ],
        attackersDeclaredThisCombatByPlayer: { p1: [{ id: 'c1' }] },
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', "if it's attacking alone", null as any, { thisCreatureId: 'c1' } as any)).toBe(true);

    ctx.state.attackersDeclaredThisCombatByPlayer = { p1: [{ id: 'c1' }, { id: 'c2' }] };
    ctx.state.battlefield[1].attacking = 'p2';
    expect(evaluateInterveningIfClause(ctx, 'p1', "if it's attacking alone", null as any, { thisCreatureId: 'c1' } as any)).toBe(false);
  });

  it("returns null for 'you attacked with exactly one creature' when declared-attacker tracking is unavailable", () => {
    const ctx: any = { state: { battlefield: [] } };
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if you attacked with exactly one creature', null as any, {} as any)).toBe(null);
  });

  it("evaluates 'this creature attacked this turn' via refs id, and returns null when unknown", () => {
    const ctx: any = {
      state: {
        battlefield: [{ id: 'c1', controller: 'p1', card: { type_line: 'Creature', name: 'Runner' } }],
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if this creature attacked this turn', null as any, { thisCreatureId: 'c1' } as any)).toBe(null);

    ctx.state.battlefield[0].attacking = 'p2';
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if this creature attacked this turn', null as any, { thisCreatureId: 'c1' } as any)).toBe(true);
  });

  it("evaluates 'it was attacking or blocking alone' via refs id when sourcePermanent is missing", () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 'c1', controller: 'p1', attacking: 'p2', card: { type_line: 'Creature', name: 'Solo' } },
          { id: 'c2', controller: 'p1', attacking: null, card: { type_line: 'Creature', name: 'Buddy' } },
        ],
        attackersDeclaredThisCombatByPlayer: { p1: [{ id: 'c1' }] },
        blockersDeclaredThisCombatByPlayer: { p1: [] },
      },
    };

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if it was attacking or blocking alone', null as any, { thisCreatureId: 'c1' } as any)
    ).toBe(true);

    ctx.state.attackersDeclaredThisCombatByPlayer = { p1: [{ id: 'c1' }, { id: 'c2' }] };
    ctx.state.battlefield[1].attacking = 'p2';
    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if it was attacking or blocking alone', null as any, { thisCreatureId: 'c1' } as any)
    ).toBe(false);
  });

  it('evaluates defending-player clauses via refs.thisCreatureId when sourcePermanent is missing', () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 'atk', controller: 'p1', attacking: 'p2', card: { type_line: 'Creature', name: 'Attacker' } },
          { id: 'p1_land', controller: 'p1', card: { type_line: 'Land', name: 'Land1' } },
          { id: 'p2_land1', controller: 'p2', card: { type_line: 'Land', name: 'Land2' } },
          { id: 'p2_land2', controller: 'p2', card: { type_line: 'Land', name: 'Land3' } },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if defending player controls more lands than you', null as any, { thisCreatureId: 'atk' } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(ctx, 'p2', "if you're the defending player", null as any, { thisCreatureId: 'atk' } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(ctx, 'p1', "if you're the defending player", null as any, { thisCreatureId: 'atk' } as any)
    ).toBe(false);
  });
});
