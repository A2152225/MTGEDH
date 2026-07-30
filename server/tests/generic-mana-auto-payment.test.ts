import { describe, expect, it } from 'vitest';

import {
  canPayManaCostStringWithAvailableSources,
  getMaxGenericManaAvailable,
  payManaCostWithAvailableSources,
} from '../src/socket/util.js';

describe('generic mana auto-payment candidates', () => {
  it('excludes mana abilities with extra activation costs from automatic generic payment', () => {
    const gameState = {
      battlefield: [
        {
          id: 'forest-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '',
          },
        },
        {
          id: 'mana-confluence-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Mana Confluence',
            type_line: 'Land',
            oracle_text: '{T}, Pay 1 life: Add one mana of any color.',
          },
        },
        {
          id: 'izzet-signet-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Izzet Signet',
            type_line: 'Artifact',
            oracle_text: '{1}, {T}: Add {U}{R}.',
          },
        },
      ],
      manaPool: {},
    };

    expect(getMaxGenericManaAvailable(gameState, 'player1')).toBe(1);
  });

  it('still counts free self-sacrifice mana sources', () => {
    const gameState = {
      battlefield: [
        {
          id: 'lotus-petal-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Lotus Petal',
            type_line: 'Artifact',
            oracle_text: 'Sacrifice Lotus Petal: Add one mana of any color.',
          },
        },
      ],
      manaPool: {},
    };

    expect(getMaxGenericManaAvailable(gameState, 'player1')).toBe(1);
  });

  it('counts tap-plus-self-sacrifice mana sources like Treasure', () => {
    const gameState = {
      battlefield: [
        {
          id: 'treasure-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Treasure',
            type_line: 'Token Artifact — Treasure',
            oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.',
          },
        },
      ],
      manaPool: {},
    };

    expect(getMaxGenericManaAvailable(gameState, 'player1')).toBe(1);
  });

  it('pays colored optional costs from untapped sources without pre-floating mana', () => {
    const gameState = {
      battlefield: [
        {
          id: 'island-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Island',
            type_line: 'Basic Land — Island',
            oracle_text: '({T}: Add {U}.)',
          },
        },
        {
          id: 'forest-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '({T}: Add {G}.)',
          },
        },
      ],
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    };

    expect(canPayManaCostStringWithAvailableSources(gameState, 'player1', '{U}{G}')).toBe(true);

    const payment = payManaCostWithAvailableSources(gameState, 'player1', '{U}{G}');
    expect(payment.ok).toBe(true);
    expect(payment.tappedPermanents).toEqual(expect.arrayContaining(['island-1', 'forest-1']));
    expect(gameState.battlefield.every((permanent) => permanent.tapped)).toBe(true);
    expect(gameState.manaPool.player1).toMatchObject({
      blue: 0,
      green: 0,
    });
  });

  it('combines floating and on-demand mana for mixed optional costs', () => {
    const gameState = {
      battlefield: [
        {
          id: 'mountain-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '({T}: Add {R}.)',
          },
        },
      ],
      manaPool: {
        player1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      },
    };

    const payment = payManaCostWithAvailableSources(gameState, 'player1', '{U}{R}');
    expect(payment.ok).toBe(true);
    expect(payment.tappedPermanents).toEqual(['mountain-1']);
    expect(gameState.manaPool.player1.blue).toBe(0);
    expect(gameState.manaPool.player1.red).toBe(0);
  });

  it('chooses a required color from an any-color source', () => {
    const gameState = {
      battlefield: [
        {
          id: 'lotus-petal-colored',
          controller: 'player1',
          owner: 'player1',
          tapped: false,
          card: {
            id: 'lotus-petal-card',
            name: 'Lotus Petal',
            type_line: 'Artifact',
            oracle_text: 'Sacrifice Lotus Petal: Add one mana of any color.',
          },
        },
      ],
      zones: {
        player1: { graveyard: [], graveyardCount: 0 },
      },
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    };

    const payment = payManaCostWithAvailableSources(gameState, 'player1', '{B}');
    expect(payment.ok).toBe(true);
    expect(payment.sacrificedPermanents).toEqual(['lotus-petal-colored']);
    expect(gameState.battlefield).toHaveLength(0);
    expect(gameState.manaPool.player1.black).toBe(0);
  });
});