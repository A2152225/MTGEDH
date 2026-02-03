import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe("Intervening-if: 'if you both own and control <X> and a creature named <Y>' (Item 77)", () => {
  it('returns true when both sides have an owned+controlled permanent', () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 's', controller: 'p1', owner: 'p1', card: { name: 'Lefty', type_line: 'Creature — Wall' } },
          { id: 'f', controller: 'p1', owner: 'p1', card: { name: 'Foo', type_line: 'Creature — Elf' } },
        ],
      },
    };

    const src = ctx.state.battlefield[0];
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if you both own and control this creature and a creature named Foo', src, {} as any)).toBe(
      true
    );
  });

  it('returns false when the named creature does not exist on the battlefield', () => {
    const ctx: any = {
      state: {
        battlefield: [{ id: 's', controller: 'p1', owner: 'p1', card: { name: 'Lefty', type_line: 'Creature' } }],
      },
    };

    const src = ctx.state.battlefield[0];
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if you both own and control this creature and a creature named Foo', src, {} as any)).toBe(
      false
    );
  });

  it('returns null when you control a candidate but its owner metadata is unknown', () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 's', controller: 'p1', owner: 'p1', card: { name: 'Lefty', type_line: 'Creature' } },
          { id: 'f', controller: 'p1', card: { name: 'Foo', type_line: 'Creature' } },
        ],
      },
    };

    const src = ctx.state.battlefield[0];
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if you both own and control this creature and a creature named Foo', src, {} as any)).toBe(
      null
    );
  });

  it('returns false when the named creature exists but you do not control it', () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 's', controller: 'p1', owner: 'p1', card: { name: 'Lefty', type_line: 'Creature' } },
          { id: 'f', controller: 'p2', owner: 'p2', card: { name: 'Foo', type_line: 'Creature' } },
        ],
      },
    };

    const src = ctx.state.battlefield[0];
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if you both own and control this creature and a creature named Foo', src, {} as any)).toBe(
      false
    );
  });

  it('supports a named left-side permanent (not just "this creature")', () => {
    const ctx: any = {
      state: {
        battlefield: [
          { id: 't', controller: 'p1', owner: 'p1', card: { name: 'Titania', type_line: 'Creature — Elemental' } },
          { id: 'f', controller: 'p1', owner: 'p1', card: { name: 'Foo', type_line: 'Creature — Elf' } },
        ],
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if you both own and control Titania and a creature named Foo', null as any, {} as any)).toBe(
      true
    );
  });
});
