import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: cast metadata templates work via refs id', () => {
  it('evaluates "if it was unearthed" via refs.thisCreatureId when sourcePermanent is missing', () => {
    const ctx: any = {
      state: {
        battlefield: [{ id: 'c1', controller: 'p1', wasUnearthed: true, card: { type_line: 'Creature', name: 'Unearthy' } }],
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', 'if it was unearthed', null as any, { thisCreatureId: 'c1' } as any)).toBe(true);
  });

  it('evaluates "if it wasn\'t cast" via refs.thisCreatureId when sourcePermanent is missing', () => {
    const ctx: any = {
      state: {
        battlefield: [{ id: 'c1', controller: 'p1', wasCast: false, card: { type_line: 'Creature', name: 'Cheaty' } }],
      },
    };

    expect(evaluateInterveningIfClause(ctx, 'p1', "if it wasn't cast", null as any, { thisCreatureId: 'c1' } as any)).toBe(true);

    ctx.state.battlefield[0].wasCast = true;
    expect(evaluateInterveningIfClause(ctx, 'p1', "if it wasn't cast", null as any, { thisCreatureId: 'c1' } as any)).toBe(false);

    delete ctx.state.battlefield[0].wasCast;
    expect(evaluateInterveningIfClause(ctx, 'p1', "if it wasn't cast", null as any, { thisCreatureId: 'c1' } as any)).toBe(null);
  });
});
