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

  it('fills Season {P} budget modes without exceeding pBudget', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        battlefield: [],
        zones: { [playerId]: { hand: [] } },
      },
    } as any;

    const decision = chooseAIModeSelectionsForStep(game, playerId, {
      modeSelectionPurpose: 'modalSpell',
      pBudget: 5,
      canRepeatModes: true,
      allowDuplicates: true,
      minModes: 0,
      maxModes: 5,
      modes: [
        { id: 'Mode 1', label: 'Draw', pCost: 1 },
        { id: 'Mode 2', label: 'Token', pCost: 2 },
        { id: 'Mode 3', label: 'Life', pCost: 3 },
      ],
    });

    expect(decision.cancelled).toBe(false);
    const costById: Record<string, number> = { 'Mode 1': 1, 'Mode 2': 2, 'Mode 3': 3 };
    const spent = decision.selections.reduce((sum, id) => sum + (costById[id] || 0), 0);
    expect(spent).toBeLessThanOrEqual(5);
    expect(spent).toBeGreaterThan(0);
  });

  it('picks fight over keyword modes when it can kill a high-threat creature', () => {
    const playerId = 'ai1' as PlayerID;
    const koglaModes = {
      sourceId: 'kogla-1',
      sourceName: 'Kogla and Yidaro',
      modes: [
        {
          id: 'Mode 1',
          label: 'It gains trample and haste until end of turn.',
          description: 'It gains trample and haste until end of turn.',
        },
        {
          id: 'Mode 2',
          label: "It fights target creature you don't control.",
          description: "It fights target creature you don't control.",
        },
      ],
      minModes: 1,
      maxModes: 1,
    };

    const game = {
      state: {
        players: [createPlayer(playerId, 'AI'), createPlayer('opp1', 'Opponent')],
        battlefield: [
          {
            id: 'kogla-1',
            controller: playerId,
            power: 7,
            toughness: 7,
            card: {
              name: 'Kogla and Yidaro',
              type_line: 'Legendary Creature — Ape Dinosaur Turtle',
              power: '7',
              toughness: '7',
              colors: ['G', 'R'],
              oracle_text: '',
            },
          },
          {
            id: 'sphinx-1',
            controller: 'opp1',
            power: 4,
            toughness: 6,
            card: {
              name: 'Consecrated Sphinx',
              type_line: 'Creature — Sphinx',
              power: '4',
              toughness: '6',
              oracle_text: 'Flying\nWhenever an opponent draws a card, you may draw two cards.',
            },
          },
        ],
        zones: { [playerId]: { hand: [] } },
      },
    } as any;

    const decision = chooseAIModeSelectionsForStep(game, playerId, koglaModes);
    expect(decision).toEqual({ selections: ['Mode 2'], cancelled: false });
  });

  it('keeps the keyword mode when fight cannot kill a real threat', () => {
    const playerId = 'ai1' as PlayerID;
    const koglaModes = {
      sourceId: 'kogla-1',
      sourceName: 'Kogla and Yidaro',
      modes: [
        {
          id: 'Mode 1',
          label: 'It gains trample and haste until end of turn.',
          description: 'It gains trample and haste until end of turn.',
        },
        {
          id: 'Mode 2',
          label: "It fights target creature you don't control.",
          description: "It fights target creature you don't control.",
        },
      ],
      minModes: 1,
      maxModes: 1,
    };

    const makeGame = (opponent: any) => ({
      state: {
        players: [createPlayer(playerId, 'AI'), createPlayer('opp1', 'Opponent')],
        battlefield: [
          {
            id: 'kogla-1',
            controller: playerId,
            power: 7,
            toughness: 7,
            card: {
              name: 'Kogla and Yidaro',
              type_line: 'Legendary Creature — Ape Dinosaur Turtle',
              power: '7',
              toughness: '7',
              colors: ['G', 'R'],
              oracle_text: '',
            },
          },
          opponent,
        ],
        zones: { [playerId]: { hand: [] } },
      },
    } as any);

    const vanilla = chooseAIModeSelectionsForStep(makeGame({
      id: 'bear-1',
      controller: 'opp1',
      power: 2,
      toughness: 2,
      card: {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        power: '2',
        toughness: '2',
        oracle_text: '',
      },
    }), playerId, koglaModes);
    expect(vanilla.selections).toEqual(['Mode 1']);

    const indestructible = chooseAIModeSelectionsForStep(makeGame({
      id: 'darksteel-1',
      controller: 'opp1',
      power: 8,
      toughness: 4,
      card: {
        name: 'Consecrated Sphinx',
        type_line: 'Creature — Sphinx',
        power: '8',
        toughness: '4',
        oracle_text: 'Flying, indestructible\nWhenever an opponent draws a card, you may draw two cards.',
      },
    }), playerId, koglaModes);
    expect(indestructible.selections).toEqual(['Mode 1']);

    const hexproof = chooseAIModeSelectionsForStep(makeGame({
      id: 'hex-1',
      controller: 'opp1',
      power: 4,
      toughness: 6,
      card: {
        name: 'Consecrated Sphinx',
        type_line: 'Creature — Sphinx',
        power: '4',
        toughness: '6',
        oracle_text: 'Flying, hexproof\nWhenever an opponent draws a card, you may draw two cards.',
      },
    }), playerId, koglaModes);
    expect(hexproof.selections).toEqual(['Mode 1']);

    const protectionFromGreen = chooseAIModeSelectionsForStep(makeGame({
      id: 'pro-g-1',
      controller: 'opp1',
      power: 4,
      toughness: 6,
      card: {
        name: 'Consecrated Sphinx',
        type_line: 'Creature — Sphinx',
        power: '4',
        toughness: '6',
        oracle_text: 'Flying, protection from green\nWhenever an opponent draws a card, you may draw two cards.',
      },
    }), playerId, koglaModes);
    expect(protectionFromGreen.selections).toEqual(['Mode 1']);
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