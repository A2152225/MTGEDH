import { describe, it, expect } from 'vitest';
import type { GameContext } from '../src/state/context';
import { getBeginningOfCombatTriggers, getEndStepTriggers } from '../src/state/modules/triggered-abilities';

describe('Intervening-if phase trigger filtering (trigger time)', () => {
  it('filters beginning-of-combat triggers when recognized intervening-if is false', () => {
    const p1 = 'p1';

    const baseState: any = {
      turnPlayer: p1,
      players: [{ id: p1 }],
      battlefield: [
        {
          id: 'perm_1',
          controller: p1,
          owner: p1,
          card: {
            id: 'c_1',
            name: 'Test Combat Permanent',
            type_line: 'Enchantment',
            oracle_text: 'At the beginning of combat on your turn, if you control an artifact, draw a card.',
          },
        },
      ],
    };

    const ctx = { state: baseState } as unknown as GameContext;

    // No artifact controlled: should not trigger at all.
    expect(getBeginningOfCombatTriggers(ctx, p1)).toHaveLength(0);

    // Add an artifact controlled by p1: should now trigger.
    baseState.battlefield.push({
      id: 'art_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'a_1',
        name: 'Test Artifact',
        type_line: 'Artifact',
        oracle_text: '',
      },
    });

    expect(getBeginningOfCombatTriggers(ctx, p1).length).toBeGreaterThan(0);
  });

  it('filters end-step triggers when recognized intervening-if is false', () => {
    const p1 = 'p1';

    const baseState: any = {
      turnPlayer: p1,
      players: [{ id: p1 }],
      creaturesAttackedThisTurn: { [p1]: 2 },
      battlefield: [
        {
          id: 'perm_2',
          controller: p1,
          owner: p1,
          card: {
            id: 'c_2',
            name: 'Test End Step Permanent',
            type_line: 'Enchantment',
            oracle_text: 'At the beginning of each end step, if you attacked with three or more creatures this turn, draw a card.',
          },
        },
      ],
    };

    const ctx = { state: baseState } as unknown as GameContext;

    // Only 2 attackers tracked: should not trigger.
    expect(getEndStepTriggers(ctx, p1)).toHaveLength(0);

    // Now satisfy the condition.
    baseState.creaturesAttackedThisTurn[p1] = 3;
    expect(getEndStepTriggers(ctx, p1).length).toBeGreaterThan(0);
  });

  it("filters end-step triggers when 'that player' refers to the active player", () => {
    const p1 = 'p1';
    const p2 = 'p2';

    const baseState: any = {
      turnPlayer: p2,
      players: [{ id: p1 }, { id: p2 }],
      zones: {
        [p2]: { hand: [], handCount: 3, libraryCount: 0, graveyard: [], graveyardCount: 0 },
      },
      battlefield: [
        {
          id: 'perm_3',
          controller: p1,
          owner: p1,
          card: {
            id: 'c_3',
            name: 'Test That Player End Step Permanent',
            type_line: 'Enchantment',
            oracle_text:
              'At the beginning of each end step, if that player has two or fewer cards in hand, draw a card.',
          },
        },
      ],
    };

    const ctx = { state: baseState } as unknown as GameContext;

    // Active player has 3 cards in hand: should not trigger at all.
    expect(getEndStepTriggers(ctx, p2)).toHaveLength(0);

    // Now satisfy the condition for the active player.
    baseState.zones[p2].handCount = 2;
    expect(getEndStepTriggers(ctx, p2).length).toBeGreaterThan(0);
  });
});
