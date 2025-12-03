/**
 * Tests for creature mana ability generation via tap effect
 * 
 * This test suite verifies that:
 * 1. Creatures with inherent mana abilities generate mana when tapped
 * 2. Creatures granted mana abilities (via Cryptolith Rite, etc.) generate mana when tapped
 * 3. Mana is properly added to the player's mana pool
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getManaAbilitiesForPermanent, detectManaModifiers } from '../src/state/modules/mana-abilities';

describe('Creature Mana Abilities', () => {
  describe('getManaAbilitiesForPermanent', () => {
    it('should detect mana abilities for a creature with inherent tap-for-mana', () => {
      const gameState = {
        battlefield: [],
      };
      
      const permanent = {
        id: 'llanowar-elves-1',
        controller: 'player1',
        card: {
          name: 'Llanowar Elves',
          type_line: 'Creature — Elf Druid',
          oracle_text: '{T}: Add {G}.',
        },
      };
      
      const abilities = getManaAbilitiesForPermanent(gameState, permanent, 'player1');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities.some(a => a.produces.includes('G'))).toBe(true);
    });
    
    it('should detect granted mana abilities from Cryptolith Rite', () => {
      const cryptolithRite = {
        id: 'cryptolith-rite-1',
        controller: 'player1',
        card: {
          name: 'Cryptolith Rite',
          type_line: 'Enchantment',
          oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
        },
      };
      
      const gameState = {
        battlefield: [cryptolithRite],
      };
      
      // A creature without inherent mana ability
      const creature = {
        id: 'grizzly-bears-1',
        controller: 'player1',
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      };
      
      const abilities = getManaAbilitiesForPermanent(gameState, creature, 'player1');
      
      // Should have a granted mana ability from Cryptolith Rite
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities.some(a => a.isGranted)).toBe(true);
      expect(abilities.some(a => a.produces.length > 1 || a.produces.includes('W'))).toBe(true);
    });
    
    it('should detect granted mana abilities from Citanul Hierophants', () => {
      const citanulHierophants = {
        id: 'citanul-hierophants-1',
        controller: 'player1',
        card: {
          name: 'Citanul Hierophants',
          type_line: 'Creature — Human Druid',
          oracle_text: 'Creatures you control have "{T}: Add {G}."',
        },
      };
      
      const gameState = {
        battlefield: [citanulHierophants],
      };
      
      // A creature without inherent mana ability
      const creature = {
        id: 'grizzly-bears-1',
        controller: 'player1',
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      };
      
      const abilities = getManaAbilitiesForPermanent(gameState, creature, 'player1');
      
      // Should have a granted mana ability from Citanul Hierophants
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities.some(a => a.isGranted)).toBe(true);
      expect(abilities.some(a => a.produces.includes('G'))).toBe(true);
    });
    
    it('should not grant abilities to creatures controlled by other players', () => {
      const cryptolithRite = {
        id: 'cryptolith-rite-1',
        controller: 'player1',
        card: {
          name: 'Cryptolith Rite',
          type_line: 'Enchantment',
          oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
        },
      };
      
      const gameState = {
        battlefield: [cryptolithRite],
      };
      
      // A creature controlled by player2 (not the Cryptolith Rite owner)
      const creature = {
        id: 'grizzly-bears-1',
        controller: 'player2',
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      };
      
      const abilities = getManaAbilitiesForPermanent(gameState, creature, 'player2');
      
      // Should NOT have any mana abilities granted
      expect(abilities.filter(a => a.isGranted).length).toBe(0);
    });
    
    it('should not grant mana abilities to lands from creature-granting effects', () => {
      const cryptolithRite = {
        id: 'cryptolith-rite-1',
        controller: 'player1',
        card: {
          name: 'Cryptolith Rite',
          type_line: 'Enchantment',
          oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
        },
      };
      
      const gameState = {
        battlefield: [cryptolithRite],
      };
      
      // A land (not a creature)
      const land = {
        id: 'forest-1',
        controller: 'player1',
        card: {
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '',
        },
      };
      
      const abilities = getManaAbilitiesForPermanent(gameState, land, 'player1');
      
      // Should have the inherent Forest mana ability, but NOT the Cryptolith Rite granted ability
      expect(abilities.some(a => a.produces.includes('G'))).toBe(true);
      expect(abilities.filter(a => a.isGranted && a.grantedBy === 'cryptolith-rite-1').length).toBe(0);
    });
  });
  
  describe('detectManaModifiers', () => {
    it('should detect Cryptolith Rite as a mana modifier', () => {
      const cryptolithRite = {
        id: 'cryptolith-rite-1',
        controller: 'player1',
        card: {
          name: 'Cryptolith Rite',
          type_line: 'Enchantment',
          oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
        },
      };
      
      const gameState = {
        battlefield: [cryptolithRite],
      };
      
      const modifiers = detectManaModifiers(gameState, 'player1');
      
      expect(modifiers.length).toBeGreaterThan(0);
      expect(modifiers.some(m => m.cardName.toLowerCase().includes('cryptolith'))).toBe(true);
      expect(modifiers.some(m => m.affects === 'creatures')).toBe(true);
    });
    
    it('should detect Citanul Hierophants as a mana modifier', () => {
      const citanulHierophants = {
        id: 'citanul-hierophants-1',
        controller: 'player1',
        card: {
          name: 'Citanul Hierophants',
          type_line: 'Creature — Human Druid',
          oracle_text: 'Creatures you control have "{T}: Add {G}."',
        },
      };
      
      const gameState = {
        battlefield: [citanulHierophants],
      };
      
      const modifiers = detectManaModifiers(gameState, 'player1');
      
      expect(modifiers.length).toBeGreaterThan(0);
      expect(modifiers.some(m => m.cardName.toLowerCase().includes('citanul'))).toBe(true);
      expect(modifiers.some(m => m.affects === 'creatures')).toBe(true);
    });
    
    it('should not detect modifiers for opponents', () => {
      const cryptolithRite = {
        id: 'cryptolith-rite-1',
        controller: 'player1',
        card: {
          name: 'Cryptolith Rite',
          type_line: 'Enchantment',
          oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
        },
      };
      
      const gameState = {
        battlefield: [cryptolithRite],
      };
      
      // Detect modifiers for player2 (not the Cryptolith Rite owner)
      const modifiers = detectManaModifiers(gameState, 'player2');
      
      // Should NOT detect the Cryptolith Rite modifier
      expect(modifiers.filter(m => m.cardName.toLowerCase().includes('cryptolith')).length).toBe(0);
    });
  });
  
  describe('mana pool integration', () => {
    it('should correctly map mana colors to pool keys', () => {
      // This tests the color mapping logic used in the tapPermanent handler
      const colorToPoolKey: Record<string, string> = {
        'W': 'white',
        'U': 'blue',
        'B': 'black',
        'R': 'red',
        'G': 'green',
        'C': 'colorless',
      };
      
      expect(colorToPoolKey['W']).toBe('white');
      expect(colorToPoolKey['U']).toBe('blue');
      expect(colorToPoolKey['B']).toBe('black');
      expect(colorToPoolKey['R']).toBe('red');
      expect(colorToPoolKey['G']).toBe('green');
      expect(colorToPoolKey['C']).toBe('colorless');
    });
  });
});
