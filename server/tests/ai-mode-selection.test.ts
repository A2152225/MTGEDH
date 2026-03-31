import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { chooseAIModeSelectionsForStep, chooseAIOptionSelectionsForStep } from '../src/socket/ai.js';

function createPlayer(id: string, name: string, life = 40) {
  return { id, name, life } as any;
}

describe('AI mode selection', () => {
  it('chooses land for Abundant Harvest when mana development is short', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        battlefield: [
          { controller: playerId, card: { type_line: 'Basic Land — Forest' } },
          { controller: playerId, card: { type_line: 'Basic Land — Island' } },
        ],
        zones: {
          [playerId]: {
            hand: [],
          },
        },
      },
    } as any;

    const decision = chooseAIModeSelectionsForStep(game, playerId, {
      modeSelectionPurpose: 'abundantChoice',
      modes: [
        { id: 'land', label: 'Land' },
        { id: 'nonland', label: 'Nonland' },
      ],
      minModes: 1,
      maxModes: 1,
    });

    expect(decision).toEqual({ selections: ['land'], cancelled: false });
  });

  it('chooses overload when affordable and multiple opposing permanents exist', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI'), createPlayer('opp1', 'Opponent')],
        battlefield: [
          { controller: 'opp1', card: { type_line: 'Creature — Beast' } },
          { controller: 'opp1', card: { type_line: 'Artifact' } },
        ],
        manaPool: {
          [playerId]: { white: 0, blue: 7, black: 0, red: 0, green: 0, colorless: 0 },
        },
        zones: {
          [playerId]: {
            hand: [
              {
                id: 'rift',
                name: 'Cyclonic Rift',
                type_line: 'Instant',
                oracle_text: 'Return target nonland permanent you don\'t control to its owner\'s hand. Overload {6}{U}',
                mana_cost: '{1}{U}',
              },
            ],
          },
        },
      },
    } as any;

    const decision = chooseAIModeSelectionsForStep(game, playerId, {
      sourceId: 'rift',
      modeSelectionPurpose: 'overload',
      castSpellFromHandArgs: { cardId: 'rift' },
      modes: [
        { id: 'normal', label: 'Normal' },
        { id: 'overload', label: 'Overload' },
      ],
      minModes: 1,
      maxModes: 1,
    });

    expect(decision).toEqual({ selections: ['overload'], cancelled: false });
  });

  it('declines ward when a Signet bundle only looks affordable in the aggregate pool', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI'), createPlayer('opp1', 'Opponent')],
        battlefield: [
          {
            id: 'island_1',
            controller: playerId,
            tapped: false,
            card: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' },
          },
          {
            id: 'izzet_signet_1',
            controller: playerId,
            tapped: false,
            card: { name: 'Izzet Signet', type_line: 'Artifact', oracle_text: '{1}, {T}: Add {U}{R}.' },
          },
        ],
        manaPool: {
          [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      wardPayment: true,
      wardPaymentType: 'mana',
      wardCost: '{U}{U}',
      options: [
        { id: 'pay_ward_cost', label: 'Pay ward' },
        { id: 'decline_ward_cost', label: 'Decline ward' },
      ],
    });

    expect(decision).toEqual({ selections: ['decline_ward_cost'], cancelled: false });
  });
});