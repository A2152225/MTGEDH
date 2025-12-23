import { describe, it, expect } from 'vitest';
import { getAvailableMana, parseManaCost, canPayManaCost } from '../src/state/modules/mana-check.js';

/**
 * Tests for conditional mana sources like Exotic Orchard, Fellwar Stone, etc.
 * These sources should only produce colors that opponent lands/permanents can produce.
 */
describe('Conditional Mana Sources', () => {
  describe('Exotic Orchard', () => {
    it('should not produce any color when opponents have no lands', () => {
      const state = {
        battlefield: [
          {
            id: 'perm_1',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Exotic Orchard',
              type_line: 'Land',
              oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
            },
          },
        ],
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Should not add any colors since opponents have no lands
      expect(mana.white).toBe(0);
      expect(mana.blue).toBe(0);
      expect(mana.black).toBe(0);
      expect(mana.red).toBe(0);
      expect(mana.green).toBe(0);
      expect(mana.colorless).toBe(0);
    });

    it('should only produce colors that opponent lands can produce', () => {
      const state = {
        battlefield: [
          // Player 1's Exotic Orchard
          {
            id: 'perm_1',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Exotic Orchard',
              type_line: 'Land',
              oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
            },
          },
          // Opponent has a Mountain
          {
            id: 'perm_2',
            controller: 'player2',
            tapped: false,
            card: {
              name: 'Mountain',
              type_line: 'Basic Land — Mountain',
              oracle_text: '',
            },
          },
          // Opponent has a Forest
          {
            id: 'perm_3',
            controller: 'player2',
            tapped: false,
            card: {
              name: 'Forest',
              type_line: 'Basic Land — Forest',
              oracle_text: '',
            },
          },
        ],
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Should only add red and green (from opponent's Mountain and Forest)
      expect(mana.white).toBe(0);
      expect(mana.blue).toBe(0);
      expect(mana.black).toBe(0);
      expect(mana.red).toBe(1); // From Exotic Orchard mirroring opponent's Mountain
      expect(mana.green).toBe(1); // From Exotic Orchard mirroring opponent's Forest
      expect(mana.colorless).toBe(0);
    });

    it('should not allow casting 4-color commander with insufficient colors', () => {
      const state = {
        battlefield: [
          // Player 1's lands
          {
            id: 'perm_1',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Mountain',
              type_line: 'Basic Land — Mountain',
              oracle_text: '',
            },
          },
          {
            id: 'perm_2',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Mountain',
              type_line: 'Basic Land — Mountain',
              oracle_text: '',
            },
          },
          {
            id: 'perm_3',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Forest',
              type_line: 'Basic Land — Forest',
              oracle_text: '',
            },
          },
          {
            id: 'perm_4',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Exotic Orchard',
              type_line: 'Land',
              oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
            },
          },
          // Player 1's Sol Ring
          {
            id: 'perm_5',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Sol Ring',
              type_line: 'Artifact',
              oracle_text: '{T}: Add {C}{C}.',
            },
          },
          // Opponents only have red and green lands (no white or blue)
          {
            id: 'perm_6',
            controller: 'player2',
            tapped: false,
            card: {
              name: 'Mountain',
              type_line: 'Basic Land — Mountain',
              oracle_text: '',
            },
          },
          {
            id: 'perm_7',
            controller: 'player3',
            tapped: false,
            card: {
              name: 'Forest',
              type_line: 'Basic Land — Forest',
              oracle_text: '',
            },
          },
        ],
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Available mana should be:
      // - 2 red (from 2 Mountains)
      // - 1 green (from 1 Forest)
      // - 1 red OR 1 green (from Exotic Orchard - can produce either red or green)
      // - 2 colorless (from Sol Ring)
      // Total: 2 red, 2 green, 2 colorless (since Exotic Orchard adds to both red and green)
      expect(mana.white).toBe(0);
      expect(mana.blue).toBe(0);
      expect(mana.black).toBe(0);
      expect(mana.red).toBe(3); // 2 Mountains + 1 from Exotic Orchard
      expect(mana.green).toBe(2); // 1 Forest + 1 from Exotic Orchard
      expect(mana.colorless).toBe(2); // Sol Ring
      
      // Kynaios and Tiro of Meletis costs {W}{U}{R}{G}
      const kynaiosCost = parseManaCost('{W}{U}{R}{G}');
      
      // Should NOT be able to cast it - missing white and blue
      expect(canPayManaCost(mana, kynaiosCost)).toBe(false);
    });

    it('should allow casting 2-color commander with available colors from Exotic Orchard', () => {
      const state = {
        battlefield: [
          // Player 1's Exotic Orchard
          {
            id: 'perm_1',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Exotic Orchard',
              type_line: 'Land',
              oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
            },
          },
          // Player 1's Mountain
          {
            id: 'perm_2',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Mountain',
              type_line: 'Basic Land — Mountain',
              oracle_text: '',
            },
          },
          // Opponent has a Forest
          {
            id: 'perm_3',
            controller: 'player2',
            tapped: false,
            card: {
              name: 'Forest',
              type_line: 'Basic Land — Forest',
              oracle_text: '',
            },
          },
        ],
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Available: 1 red (Mountain), 1 green (Exotic Orchard from opponent's Forest)
      expect(mana.red).toBe(1);
      expect(mana.green).toBe(1);
      
      // Should be able to cast a {R}{G} spell
      const rgCost = parseManaCost('{R}{G}');
      expect(canPayManaCost(mana, rgCost)).toBe(true);
    });
  });

  describe('Unconditional "any color" sources', () => {
    it('should correctly identify Command Tower as unconditional', () => {
      const state = {
        battlefield: [
          {
            id: 'perm_1',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Command Tower',
              type_line: 'Land',
              oracle_text: '{T}: Add one mana of any color in your commander\'s color identity.',
            },
          },
        ],
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Command Tower should add to all colors (it's a true "any color" source)
      expect(mana.white).toBe(1);
      expect(mana.blue).toBe(1);
      expect(mana.black).toBe(1);
      expect(mana.red).toBe(1);
      expect(mana.green).toBe(1);
      expect(mana.anyColor).toBe(1); // Should track "any color" sources
    });
  });

  describe('Fellwar Stone (conditional artifact)', () => {
    it('should only produce colors that opponent lands can produce', () => {
      const state = {
        battlefield: [
          // Player 1's Fellwar Stone
          {
            id: 'perm_1',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Fellwar Stone',
              type_line: 'Artifact',
              oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
            },
          },
          // Opponent has an Island
          {
            id: 'perm_2',
            controller: 'player2',
            tapped: false,
            card: {
              name: 'Island',
              type_line: 'Basic Land — Island',
              oracle_text: '',
            },
          },
        ],
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Should only add blue (from opponent's Island)
      expect(mana.white).toBe(0);
      expect(mana.blue).toBe(1);
      expect(mana.black).toBe(0);
      expect(mana.red).toBe(0);
      expect(mana.green).toBe(0);
    });
  });
});
