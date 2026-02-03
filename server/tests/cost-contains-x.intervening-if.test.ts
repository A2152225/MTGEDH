import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: cost contains {X} (spell mana cost / ability activation cost)', () => {
  it('reads that spell mana cost from the triggering stack item', () => {
    const g: any = { state: { stack: [] } };

    const spellWithX = { id: 's1', type: 'spell', card: { mana_cost: '{X}{G}' } };
    const spellWithoutX = { id: 's2', type: 'spell', card: { mana_cost: '{2}{G}' } };
    g.state.stack.push(spellWithX, spellWithoutX);

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        "if that spell's mana cost or that ability's activation cost contains {X}",
        { triggeringStackItemId: 's1' } as any
      )
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        "if that spell's mana cost or that ability's activation cost contains {X}",
        { triggeringStackItemId: 's2' } as any
      )
    ).toBe(false);
  });

  it('can detect {X} in an activated ability cost when abilityText/description begins with a cost', () => {
    const g: any = { state: { stack: [] } };

    const abilityWithX = { id: 'a1', type: 'ability', description: '{X}, {T}: Draw a card.' };
    const abilityWithoutX = { id: 'a2', type: 'ability', description: '{2}, {T}: Draw a card.' };
    const abilityNoCostPrefix = { id: 'a3', type: 'ability', description: 'Search your library for a land card, then shuffle.' };
    g.state.stack.push(abilityWithX, abilityWithoutX, abilityNoCostPrefix);

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        "if that spell's mana cost or that ability's activation cost contains {X}",
        { triggeringStackItemId: 'a1' } as any
      )
    ).toBe(true);

    // Deterministic false is OK when the activation cost is explicitly present and does not contain {X}.
    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        "if that spell's mana cost or that ability's activation cost contains {X}",
        { triggeringStackItemId: 'a2' } as any
      )
    ).toBe(false);

    // Conservative: do not infer costs from effect-only descriptions.
    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        "if that spell's mana cost or that ability's activation cost contains {X}",
        { triggeringStackItemId: 'a3' } as any
      )
    ).toBe(null);
  });

  it('respects explicit boolean refs when provided', () => {
    const g: any = { state: {} };

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        "if that spell's mana cost or that ability's activation cost contains {X}",
        {} as any,
        { costContainsX: true } as any
      )
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        "if that spell's mana cost or that ability's activation cost contains {X}",
        {} as any,
        { manaCostContainsX: false } as any
      )
    ).toBe(false);
  });
});
