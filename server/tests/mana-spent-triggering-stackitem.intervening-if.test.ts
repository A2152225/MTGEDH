import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: mana-spent-to-cast templates can use triggering stack item', () => {
  it('uses triggering stack item for "if at least N mana was spent to cast it"', () => {
    const ctx: any = { state: { stack: [] } };

    ctx.state.stack.push({
      id: 's1',
      type: 'spell',
      manaSpentBreakdown: { red: 1, green: 1 },
      manaSpentTotal: 2,
    });

    const sourcePermanent: any = { id: 'inga', type: 'permanent' };

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if at least two mana was spent to cast it', sourcePermanent, {
        triggeringStackItemId: 's1',
      } as any)
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if at least three mana was spent to cast it', sourcePermanent, {
        triggeringStackItemId: 's1',
      } as any)
    ).toBe(false);
  });

  it('uses triggering stack item for "if no mana was spent to cast it"', () => {
    const ctx: any = { state: { stack: [] } };

    ctx.state.stack.push({
      id: 's2',
      type: 'spell',
      manaSpentTotal: 0,
      manaSpentBreakdown: { colorless: 0 },
    });

    const sourcePermanent: any = { id: 'inga', type: 'permanent' };

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if no mana was spent to cast it', sourcePermanent, {
        triggeringStackItemId: 's2',
      } as any)
    ).toBe(true);
  });

  it('uses triggering stack item for "if no colored mana was spent to cast it"', () => {
    const ctx: any = { state: { stack: [] } };

    ctx.state.stack.push({
      id: 's3',
      type: 'spell',
      manaSpentBreakdown: { colorless: 2 },
      manaSpentTotal: 2,
    });

    const sourcePermanent: any = { id: 'inga', type: 'permanent' };

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if no colored mana was spent to cast it', sourcePermanent, {
        triggeringStackItemId: 's3',
      } as any)
    ).toBe(true);
  });

  it('uses triggering stack item for "if three or more mana from creatures was spent to cast it"', () => {
    const ctx: any = { state: { stack: [] } };

    ctx.state.stack.push({ id: 's4', type: 'spell', manaFromCreaturesSpent: 3 });
    ctx.state.stack.push({ id: 's5', type: 'spell', manaFromCreaturesSpent: 2 });

    const sourcePermanent: any = { id: 'inga', type: 'permanent' };

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if three or more mana from creatures was spent to cast it', sourcePermanent, {
        triggeringStackItemId: 's4',
      } as any)
    ).toBe(true);

    // Deterministic false is OK when an explicit numeric marker is available.
    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if three or more mana from creatures was spent to cast it', sourcePermanent, {
        triggeringStackItemId: 's5',
      } as any)
    ).toBe(false);
  });

  it('can infer 3+ creature mana from convoke tapped creature list', () => {
    const ctx: any = { state: { stack: [] } };

    ctx.state.stack.push({ id: 's6', type: 'spell', convokeTappedCreatures: ['c1', 'c2', 'c3'] });
    ctx.state.stack.push({ id: 's7', type: 'spell', convokeTappedCreatures: ['c1', 'c2'] });

    const sourcePermanent: any = { id: 'inga', type: 'permanent' };

    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if three or more mana from creatures was spent to cast it', sourcePermanent, {
        triggeringStackItemId: 's6',
      } as any)
    ).toBe(true);

    // Positive-only: convoke count < 3 does not prove the clause is false.
    expect(
      evaluateInterveningIfClause(ctx, 'p1', 'if three or more mana from creatures was spent to cast it', sourcePermanent, {
        triggeringStackItemId: 's7',
      } as any)
    ).toBe(null);
  });
});
