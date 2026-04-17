import { describe, expect, it } from 'vitest';

import { getMaxGenericManaAvailable } from '../src/socket/util.js';

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
});