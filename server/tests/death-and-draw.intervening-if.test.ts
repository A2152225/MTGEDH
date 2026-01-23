import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import type { GameContext } from '../src/state/context';
import { getCardDrawTriggers } from '../src/state/modules/triggers/card-draw';

describe('Intervening-if filtering for additional trigger pipelines', () => {
  it('does not put a death trigger on the stack when intervening-if is false at trigger time', () => {
    const g = createInitialGameState('t_death_intervening_if');
    const p1 = 'p1' as PlayerID;

    // Permanent with an intervening-if death trigger.
    g.state.battlefield.push({
      id: 'death_ench',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'death_ench_card',
        name: 'Test Death Enchantment',
        type_line: 'Enchantment',
        oracle_text: 'Whenever a creature dies, if you control an artifact, draw a card.',
      },
    } as any);

    // A creature to die.
    g.state.battlefield.push({
      id: 'dying_1',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'dying_1_card',
        name: 'Dying Creature',
        type_line: 'Creature — Beast',
        power: '1',
        toughness: '1',
      },
    } as any);

    (g as any).movePermanentToGraveyard('dying_1', true);

    const stack1 = g.state.stack || [];
    expect(stack1.some((s: any) => s?.type === 'triggered_ability' && s?.sourceName === 'Test Death Enchantment')).toBe(false);

    // Clear stack and satisfy condition, then kill another creature.
    g.state.stack = [] as any;
    g.state.battlefield.push({
      id: 'art_1',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'art_1_card',
        name: 'Test Artifact',
        type_line: 'Artifact',
        oracle_text: '',
      },
    } as any);

    g.state.battlefield.push({
      id: 'dying_2',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'dying_2_card',
        name: 'Dying Creature 2',
        type_line: 'Creature — Beast',
        power: '1',
        toughness: '1',
      },
    } as any);

    (g as any).movePermanentToGraveyard('dying_2', true);

    const stack2 = g.state.stack || [];
    expect(stack2.some((s: any) => s?.type === 'triggered_ability' && s?.sourceName === 'Test Death Enchantment')).toBe(true);
  });

  it('filters card-draw triggers when intervening-if is false at trigger time', () => {
    const p1 = 'p1' as PlayerID;

    const state: any = {
      players: [{ id: p1 }],
      battlefield: [
        {
          id: 'draw_ench',
          controller: p1,
          owner: p1,
          card: {
            id: 'draw_ench_card',
            name: 'Test Draw Enchantment',
            type_line: 'Enchantment',
            oracle_text: 'Whenever you draw a card, if you control an artifact, you gain 1 life.',
          },
        },
      ],
    };

    const ctx = { state } as unknown as GameContext;

    // No artifact controlled: should not trigger.
    expect(getCardDrawTriggers(ctx, p1)).toHaveLength(0);

    // Add an artifact: should trigger.
    state.battlefield.push({
      id: 'art_2',
      controller: p1,
      owner: p1,
      card: {
        id: 'art_2_card',
        name: 'Test Artifact',
        type_line: 'Artifact',
        oracle_text: '',
      },
    });

    expect(getCardDrawTriggers(ctx, p1).length).toBeGreaterThan(0);
  });

  it('filters card-draw triggers when intervening-if refers to "that player" hand size', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    const state: any = {
      players: [{ id: p1 }, { id: p2 }],
      battlefield: [
        {
          id: 'opp_draw_ench',
          controller: p1,
          owner: p1,
          card: {
            id: 'opp_draw_ench_card',
            name: 'Test Opponent Draw Enchantment',
            type_line: 'Enchantment',
            oracle_text:
              "Whenever an opponent draws a card, if that player has two or fewer cards in hand, you gain 1 life.",
          },
        },
      ],
      zones: {
        [p1]: { hand: [] },
        [p2]: { hand: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] },
      },
    };

    const ctx = { state } as unknown as GameContext;

    // p2 draws, but has 3 cards in hand => condition false => no trigger.
    expect(getCardDrawTriggers(ctx, p2)).toHaveLength(0);

    // p2 now has 2 cards in hand => condition true => trigger.
    state.zones[p2].hand = [{ id: 'c1' }, { id: 'c2' }];
    expect(getCardDrawTriggers(ctx, p2).length).toBeGreaterThan(0);
  });
});
