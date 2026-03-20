import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { chooseAIOptionSelectionsForStep } from '../src/socket/ai.js';

function createPlayer(id: string, name: string, life = 40) {
  return { id, name, life } as any;
}

describe('AI option choice', () => {
  it('declines may-draw prompts when library is nearly empty', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        zones: {
          [playerId]: {
            library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          },
        },
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      mayAbilityPrompt: true,
      effectText: 'Draw a card.',
      description: 'You may draw a card.',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
    });

    expect(decision).toEqual({ selections: ['no'], cancelled: true });
  });

  it('pays life for shock lands when life is healthy and untapped mana matters', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI', 18)],
        life: { [playerId]: 18 },
        turnPlayer: playerId,
        phase: 'main',
        zones: {
          [playerId]: {
            hand: [{ id: 'spell1', name: 'Arcane Signet', mana_cost: '{2}' }],
          },
        },
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      shockLandChoice: true,
      payLifeAmount: 2,
      options: [
        { id: 'enter_tapped', label: 'Have it enter tapped' },
        { id: 'pay_2_life', label: 'Pay 2 life (enter untapped)' },
      ],
    });

    expect(decision).toEqual({ selections: ['pay_2_life'], cancelled: false });
  });

  it('declines mana ward when the AI cannot pay', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        manaPool: { [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
        zones: {
          [playerId]: {
            hand: [],
          },
        },
        stack: [
          {
            id: 'spell1',
            card: {
              id: 'spell-card',
              name: 'Beast Within',
              type_line: 'Instant',
              oracle_text: 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
              mana_cost: '{2}{G}',
            },
          },
        ],
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      wardPayment: true,
      wardPaymentType: 'mana',
      wardCost: '{2}',
      wardTriggeredBy: 'spell1',
      options: [
        { id: 'pay_ward_cost', label: 'Pay {2}' },
        { id: 'decline_ward_cost', label: 'Decline (counter)' },
      ],
    });

    expect(decision).toEqual({ selections: ['decline_ward_cost'], cancelled: false });
  });
});