import { describe, it, expect } from 'vitest';
import { getAvailableMana, getTotalManaFromPool } from '../src/state/modules/mana-check';

describe('Conditional Mana Sources - Fellwar Stone, Command Tower, and Exotic Orchard Subtypes', () => {
  it('should detect opponent Snow-Covered basic lands for Exotic Orchard / Fellwar Stone', () => {
    const state = {
      battlefield: [
        {
          id: 'fellwar_stone_1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Fellwar Stone',
            type_line: 'Artifact',
            oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
          },
        },
        {
          id: 'snow_covered_island',
          controller: 'player2',
          tapped: false,
          card: {
            name: 'Snow-Covered Island',
            type_line: 'Basic Snow Land — Island',
            oracle_text: '',
          },
        },
      ],
      commandZone: {},
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    };

    const mana = getAvailableMana(state, 'player1');
    expect(mana.blue).toBe(1); // Should detect blue from Snow-Covered Island
    expect(mana.white || 0).toBe(0);
    expect(mana.anyColor || 0).toBe(0);
    expect(getTotalManaFromPool(mana)).toBe(1); // Should represent exactly 1 total net mana
  });

  it('should detect opponent dual subtype lands like Hallowed Fountain', () => {
    const state = {
      battlefield: [
        {
          id: 'fellwar_stone_1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Fellwar Stone',
            type_line: 'Artifact',
            oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
          },
        },
        {
          id: 'hallowed_fountain',
          controller: 'player2',
          tapped: false,
          card: {
            name: 'Hallowed Fountain',
            type_line: 'Land — Plains Island',
            oracle_text: '{T}: Add {W} or {U}',
          },
        },
      ],
      commandZone: {},
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    };

    const mana = getAvailableMana(state, 'player1');
    expect(mana.white).toBe(1); // Should detect Plains
    expect(mana.blue).toBe(1);  // Should detect Island
    expect(mana.black || 0).toBe(0);
    expect(mana.anyColor || 0).toBe(0);
    expect(getTotalManaFromPool(mana)).toBe(1); // Dual choice from 1 source should equal 1 total mana
  });

  it('should detect opponent Command Tower using their commander identity', () => {
    const state = {
      battlefield: [
        {
          id: 'fellwar_stone_1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Fellwar Stone',
            type_line: 'Artifact',
            oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
          },
        },
        {
          id: 'command_tower_opp',
          controller: 'player2',
          tapped: false,
          card: {
            name: 'Command Tower',
            type_line: 'Land',
            oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
          },
        },
      ],
      commandZone: {
        player2: {
          commanderCards: [
            {
              id: 'morophon',
              name: 'Morophon, the Boundless',
              color_identity: ['W', 'U', 'B', 'R', 'G'],
            },
          ],
        },
      },
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    };

    const mana = getAvailableMana(state, 'player1');
    expect(mana.white).toBe(1);
    expect(mana.blue).toBe(1);
    expect(mana.black).toBe(1);
    expect(mana.red).toBe(1);
    expect(mana.green).toBe(1);
    expect(mana.anyColor || 0).toBe(0);
    expect(getTotalManaFromPool(mana)).toBe(1); // choice colors of 5 options from 1 source is 1 total mana
  });

  it('should not recurse when both players have Exotic Orchard and nothing else', () => {
    const state = {
      battlefield: [
        {
          id: 'orchard_1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Exotic Orchard',
            type_line: 'Land',
            oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
          },
        },
        {
          id: 'orchard_2',
          controller: 'player2',
          tapped: false,
          card: {
            name: 'Exotic Orchard',
            type_line: 'Land',
            oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
          },
        },
      ],
      commandZone: {},
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    };

    const mana = getAvailableMana(state, 'player1');
    expect(mana.white).toBe(0);
    expect(mana.blue).toBe(0);
    expect(mana.black).toBe(0);
    expect(mana.red).toBe(0);
    expect(mana.green).toBe(0);
    expect(mana.colorless || 0).toBe(0);
  });

  it('should mirror opponent Mountain through a second Exotic Orchard without inventing WUBRG', () => {
    const state = {
      battlefield: [
        {
          id: 'orchard_1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Exotic Orchard',
            type_line: 'Land',
            oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
          },
        },
        {
          id: 'orchard_2',
          controller: 'player2',
          tapped: false,
          card: {
            name: 'Exotic Orchard',
            type_line: 'Land',
            oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
          },
        },
        {
          id: 'mountain_opp',
          controller: 'player2',
          tapped: false,
          card: {
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '',
          },
        },
      ],
      commandZone: {},
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    };

    const mana = getAvailableMana(state, 'player1');
    expect(mana.red).toBe(1);
    expect(mana.white || 0).toBe(0);
    expect(mana.blue || 0).toBe(0);
    expect(mana.black || 0).toBe(0);
    expect(mana.green || 0).toBe(0);
    expect(getTotalManaFromPool(mana)).toBe(1);
  });

  it('should see Yavimaya-granted Forest on an opponent Mountain', () => {
    const state = {
      battlefield: [
        {
          id: 'orchard_1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Exotic Orchard',
            type_line: 'Land',
            oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
          },
        },
        {
          id: 'yavimaya',
          controller: 'player2',
          tapped: false,
          card: {
            name: 'Yavimaya, Cradle of Growth',
            type_line: 'Legendary Land',
            oracle_text: 'Each land is a Forest in addition to its other types.',
          },
        },
        {
          id: 'mountain_opp',
          controller: 'player2',
          tapped: false,
          card: {
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '',
          },
        },
      ],
      commandZone: {},
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    };

    const mana = getAvailableMana(state, 'player1');
    expect(mana.red).toBe(1);
    expect(mana.green).toBe(1);
    expect(mana.white || 0).toBe(0);
    expect(mana.blue || 0).toBe(0);
    expect(mana.black || 0).toBe(0);
  });
});
