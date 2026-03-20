import { describe, expect, it } from 'vitest';
import { chooseAIOptionSelectionsForStep } from '../src/socket/ai.js';

describe('AI modal choice heuristics', () => {
  it('prefers offensive keyword counters for a large commander', () => {
    const game = {
      state: {
        players: [
          { id: 'ai1', life: 40 },
          { id: 'opp1', life: 40 },
        ],
        battlefield: [
          {
            id: 'commander_1',
            controller: 'ai1',
            owner: 'ai1',
            isCommander: true,
            counters: {},
            grantedAbilities: [],
            card: {
              name: 'Test Commander',
              type_line: 'Legendary Creature — Soldier',
              power: '6',
              toughness: '6',
              keywords: [],
              oracle_text: '',
            },
          },
        ],
        zones: {
          ai1: {
            hand: [],
          },
        },
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, 'ai1' as any, {
      type: 'modal_choice',
      playerId: 'ai1',
      description: 'Choose a counter type to put on Test Commander.',
      options: [
        { id: 'vigilance', label: 'Vigilance' },
        { id: 'reach', label: 'Reach' },
        { id: 'trample', label: 'Trample' },
      ],
      minSelections: 1,
      maxSelections: 1,
      keywordCounterChoiceData: {
        targetPermanentId: 'commander_1',
        targetName: 'Test Commander',
        allowedKeywords: ['vigilance', 'reach', 'trample'],
      },
    } as any);

    expect(decision.selections).toEqual(['trample']);
    expect(decision.cancelled).toBe(false);
  });

  it('chooses the highest-impact creature for put-from-hand modal choices', () => {
    const game = {
      state: {
        players: [
          { id: 'ai1', life: 40 },
        ],
        battlefield: [],
        zones: {
          ai1: {
            hand: [
              {
                id: 'bear_1',
                name: 'Runeclaw Bear',
                type_line: 'Creature — Bear',
                power: '2',
                toughness: '2',
                cmc: 2,
                oracle_text: '',
              },
              {
                id: 'dragon_1',
                name: 'Ancient Silver Dragon',
                type_line: 'Creature — Elder Dragon',
                power: '8',
                toughness: '8',
                cmc: 8,
                oracle_text: 'Flying',
              },
            ],
          },
        },
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, 'ai1' as any, {
      type: 'modal_choice',
      playerId: 'ai1',
      description: 'You may put a creature card from your hand onto the battlefield tapped and attacking.',
      options: [
        { id: 'decline', label: 'Decline' },
        { id: 'bear_1', label: 'Runeclaw Bear' },
        { id: 'dragon_1', label: 'Ancient Silver Dragon' },
      ],
      minSelections: 0,
      maxSelections: 1,
      putFromHandData: {
        tappedAndAttacking: true,
        validCardIds: ['bear_1', 'dragon_1'],
      },
    } as any);

    expect(decision.selections).toEqual(['dragon_1']);
    expect(decision.cancelled).toBe(false);
  });
});