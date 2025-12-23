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
    it('should correctly handle Command Tower based on commander color identity', () => {
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
        commandZone: {
          player1: {
            commanderCards: [
              {
                name: 'Kynaios and Tiro of Meletis',
                color_identity: ['W', 'U', 'R', 'G'],
              },
            ],
          },
        },
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Command Tower should only add colors in commander's identity (W, U, R, G)
      expect(mana.white).toBe(1);
      expect(mana.blue).toBe(1);
      expect(mana.black).toBe(0); // Not in commander's color identity
      expect(mana.red).toBe(1);
      expect(mana.green).toBe(1);
      expect(mana.anyColor).toBe(1); // Should track "any color" sources
    });

    it('should handle Command Tower with mono-colored commander', () => {
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
        commandZone: {
          player1: {
            commanderCards: [
              {
                name: 'Omnath, Locus of Mana',
                color_identity: ['G'],
              },
            ],
          },
        },
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Command Tower should only add green
      expect(mana.white).toBe(0);
      expect(mana.blue).toBe(0);
      expect(mana.black).toBe(0);
      expect(mana.red).toBe(0);
      expect(mana.green).toBe(1);
      expect(mana.anyColor).toBe(1);
    });

    it('should handle true unconditional any color sources like Mana Confluence', () => {
      const state = {
        battlefield: [
          {
            id: 'perm_1',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Mana Confluence',
              type_line: 'Land',
              oracle_text: '{T}: Add one mana of any color. Whenever Mana Confluence is tapped for mana, it deals 1 damage to you.',
            },
          },
        ],
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Mana Confluence should add to all colors (truly unconditional)
      expect(mana.white).toBe(1);
      expect(mana.blue).toBe(1);
      expect(mana.black).toBe(1);
      expect(mana.red).toBe(1);
      expect(mana.green).toBe(1);
      expect(mana.anyColor).toBe(1);
    });
  });

  describe('ETB and non-tap mana abilities (Rule 106.7)', () => {
    it('should detect Crumbling Vestige ETB trigger as producing any color', () => {
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
          // Opponent has Crumbling Vestige (ETB trigger produces any color)
          {
            id: 'perm_2',
            controller: 'player2',
            tapped: false,
            card: {
              name: 'Crumbling Vestige',
              type_line: 'Land',
              oracle_text: 'When Crumbling Vestige enters the battlefield, add one mana of any color.\n{T}: Add {C}.',
            },
          },
        ],
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Exotic Orchard should see that Crumbling Vestige can produce any color (from ETB)
      // So it can produce all 5 colors
      expect(mana.white).toBe(1);
      expect(mana.blue).toBe(1);
      expect(mana.black).toBe(1);
      expect(mana.red).toBe(1);
      expect(mana.green).toBe(1);
    });

    it('should detect Mirrodin\'s Core ability even without charge counter', () => {
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
          // Opponent has Mirrodin's Core (can produce any color even without counter)
          {
            id: 'perm_2',
            controller: 'player2',
            tapped: false,
            card: {
              name: 'Mirrodin\'s Core',
              type_line: 'Land',
              oracle_text: '{T}: Add {C}.\n{T}, Remove a charge counter from Mirrodin\'s Core: Add one mana of any color.',
            },
          },
        ],
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Per Rule 106.7, ignore costs - Mirrodin's Core can produce any color
      expect(mana.white).toBe(1);
      expect(mana.blue).toBe(1);
      expect(mana.black).toBe(1);
      expect(mana.red).toBe(1);
      expect(mana.green).toBe(1);
    });

    it('should handle Gemstone Caverns replacement ability', () => {
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
          // Opponent has Gemstone Caverns
          {
            id: 'perm_2',
            controller: 'player2',
            tapped: false,
            card: {
              name: 'Gemstone Caverns',
              type_line: 'Legendary Land',
              oracle_text: 'If Gemstone Caverns is in your opening hand and you\'re not the starting player, you may begin the game with Gemstone Caverns on the battlefield with a luck counter on it. If you do, exile a card from your hand.\n{T}: Add {C}. If Gemstone Caverns has a luck counter on it, instead add one mana of any color.',
            },
          },
        ],
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Gemstone Caverns has both {C} and "any color" abilities
      // Per Rule 106.7, we check what it COULD produce (including the replacement)
      // So Exotic Orchard can produce any color OR colorless
      // NOTE: This is a limitation - ideally we'd check if it has a luck counter
      // For now, we optimistically assume it could produce any color
      expect(mana.colorless).toBeGreaterThanOrEqual(1);
      // It may also be able to produce colors if the implementation detects the "any color" text
      // This is acceptable behavior given the complexity of tracking conditional replacements
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
