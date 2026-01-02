import { describe, it, expect } from 'vitest';
import { getAvailableMana, parseManaCost, canPayManaCost } from '../src/state/modules/mana-check';

/**
 * Test suite for Arcane Signet and similar commander color identity mana sources
 * 
 * Issue: Arcane Signet's mana doesn't seem to be accounted for in canAct or canRespond
 * Root cause: Need to verify that commander color identity sources are properly detected
 */
describe('Arcane Signet and Commander Color Identity Mana Sources', () => {
  describe('Arcane Signet', () => {
    it('should produce mana in commander color identity (2-color commander)', () => {
      const state = {
        battlefield: [
          {
            id: 'perm_1',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Arcane Signet',
              type_line: 'Artifact',
              oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
            },
          },
        ],
        commandZone: {
          player1: {
            commanderCards: [
              {
                id: 'commander1',
                name: 'Aurelia, the Warleader',
                color_identity: ['W', 'R'],
              },
            ],
          },
        },
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Should add 1 to both white and red (commander colors)
      expect(mana.white).toBe(1);
      expect(mana.red).toBe(1);
      expect(mana.blue).toBe(0);
      expect(mana.black).toBe(0);
      expect(mana.green).toBe(0);
      
      // Should track as anyColor source
      expect(mana.anyColor).toBe(1);
    });

    it('should produce mana in commander color identity (5-color commander)', () => {
      const state = {
        battlefield: [
          {
            id: 'perm_1',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Arcane Signet',
              type_line: 'Artifact',
              oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
            },
          },
        ],
        commandZone: {
          player1: {
            commanderCards: [
              {
                id: 'commander1',
                name: 'The Ur-Dragon',
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
      
      // Should add 1 to all colors
      expect(mana.white).toBe(1);
      expect(mana.blue).toBe(1);
      expect(mana.black).toBe(1);
      expect(mana.red).toBe(1);
      expect(mana.green).toBe(1);
      expect(mana.anyColor).toBe(1);
    });

    it('should not produce mana without a commander', () => {
      const state = {
        battlefield: [
          {
            id: 'perm_1',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Arcane Signet',
              type_line: 'Artifact',
              oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
            },
          },
        ],
        commandZone: {
          player1: {
            commanderCards: [],
          },
        },
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Should not add any mana
      expect(mana.white).toBe(0);
      expect(mana.blue).toBe(0);
      expect(mana.black).toBe(0);
      expect(mana.red).toBe(0);
      expect(mana.green).toBe(0);
      expect(mana.anyColor || 0).toBe(0);
    });

    it('should not count mana when tapped', () => {
      const state = {
        battlefield: [
          {
            id: 'perm_1',
            controller: 'player1',
            tapped: true,  // <-- Tapped
            card: {
              name: 'Arcane Signet',
              type_line: 'Artifact',
              oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
            },
          },
        ],
        commandZone: {
          player1: {
            commanderCards: [
              {
                id: 'commander1',
                name: 'Aurelia, the Warleader',
                color_identity: ['W', 'R'],
              },
            ],
          },
        },
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Should not add any mana when tapped
      expect(mana.white).toBe(0);
      expect(mana.red).toBe(0);
    });
  });

  describe('Commander\'s Sphere', () => {
    it('should produce mana in commander color identity', () => {
      const state = {
        battlefield: [
          {
            id: 'perm_1',
            controller: 'player1',
            tapped: false,
            card: {
              name: "Commander's Sphere",
              type_line: 'Artifact',
              oracle_text: "{T}: Add one mana of any color in your commander's color identity.\nSacrifice Commander's Sphere: Draw a card.",
            },
          },
        ],
        commandZone: {
          player1: {
            commanderCards: [
              {
                id: 'commander1',
                name: 'Meren of Clan Nel Toth',
                color_identity: ['B', 'G'],
              },
            ],
          },
        },
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Should add 1 to black and green
      expect(mana.black).toBe(1);
      expect(mana.green).toBe(1);
      expect(mana.white).toBe(0);
      expect(mana.blue).toBe(0);
      expect(mana.red).toBe(0);
      expect(mana.anyColor).toBe(1);
    });
  });

  describe('Command Tower', () => {
    it('should produce mana in commander color identity (3-color commander)', () => {
      const state = {
        battlefield: [
          {
            id: 'perm_1',
            controller: 'player1',
            tapped: false,
            card: {
              name: 'Command Tower',
              type_line: 'Land',
              oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
            },
          },
        ],
        commandZone: {
          player1: {
            commanderCards: [
              {
                id: 'commander1',
                name: 'Karador, Ghost Chieftain',
                color_identity: ['W', 'B', 'G'],
              },
            ],
          },
        },
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      };

      const mana = getAvailableMana(state, 'player1');
      
      // Should add 1 to white, black, and green
      expect(mana.white).toBe(1);
      expect(mana.black).toBe(1);
      expect(mana.green).toBe(1);
      expect(mana.blue).toBe(0);
      expect(mana.red).toBe(0);
      expect(mana.anyColor).toBe(1);
    });
  });
});
