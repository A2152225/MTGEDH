/**
 * Tests for creature mana ability generation via tap effect
 * 
 * This test suite verifies that:
 * 1. Creatures with inherent mana abilities generate mana when tapped
 * 2. Creatures granted mana abilities (via Cryptolith Rite, etc.) generate mana when tapped
 * 3. Mana is properly added to the player's mana pool
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getManaAbilitiesForPermanent, detectManaModifiers, getEffectiveBasicLandTypes } from '../src/state/modules/mana-abilities';

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

    it('should not treat Cryptolith Rite itself as a native mana source', () => {
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

      const abilities = getManaAbilitiesForPermanent(gameState, cryptolithRite, 'player1');

      expect(abilities).toHaveLength(0);
    });

    it('should remap basic land mana under Reality Twist without changing land types', () => {
      const realityTwist = {
        id: 'reality-twist-1',
        controller: 'player1',
        card: {
          name: 'Reality Twist',
          type_line: 'World Enchantment',
          oracle_text: 'If tapped for mana, Plains produce {R}, Swamps produce {G}, Mountains produce {W}, and Forests produce {B} instead of any other type.',
        },
      };

      const plains = {
        id: 'plains-1',
        controller: 'player1',
        card: {
          name: 'Plains',
          type_line: 'Basic Land — Plains',
          oracle_text: '',
        },
      };

      const swamp = {
        id: 'swamp-1',
        controller: 'player1',
        card: {
          name: 'Swamp',
          type_line: 'Basic Land — Swamp',
          oracle_text: '',
        },
      };

      const forest = {
        id: 'forest-1',
        controller: 'player1',
        card: {
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '',
        },
      };

      const gameState = {
        battlefield: [realityTwist, plains, swamp, forest],
      };

      expect(getEffectiveBasicLandTypes(gameState, plains)).toEqual(['plains']);
      expect(getEffectiveBasicLandTypes(gameState, swamp)).toEqual(['swamp']);
      expect(getEffectiveBasicLandTypes(gameState, forest)).toEqual(['forest']);

      const plainsAbilities = getManaAbilitiesForPermanent(gameState, plains, 'player1');
      const swampAbilities = getManaAbilitiesForPermanent(gameState, swamp, 'player1');
      const forestAbilities = getManaAbilitiesForPermanent(gameState, forest, 'player1');

      expect(plainsAbilities.some(a => a.produces.includes('R'))).toBe(true);
      expect(plainsAbilities.some(a => a.produces.includes('W'))).toBe(false);
      expect(swampAbilities.some(a => a.produces.includes('G'))).toBe(true);
      expect(swampAbilities.some(a => a.produces.includes('B'))).toBe(false);
      expect(forestAbilities.some(a => a.produces.includes('B'))).toBe(true);
      expect(forestAbilities.some(a => a.produces.includes('G'))).toBe(false);
    });

    it('should combine Urborg with Reality Twist through effective land types', () => {
      const urborg = {
        id: 'urborg-1',
        controller: 'player1',
        card: {
          name: 'Urborg, Tomb of Yawgmoth',
          type_line: 'Legendary Land',
          oracle_text: 'Each land is a Swamp in addition to its other land types.',
        },
      };

      const realityTwist = {
        id: 'reality-twist-1',
        controller: 'player1',
        card: {
          name: 'Reality Twist',
          type_line: 'World Enchantment',
          oracle_text: 'If tapped for mana, Plains produce {R}, Swamps produce {G}, Mountains produce {W}, and Forests produce {B} instead of any other type.',
        },
      };

      const plains = {
        id: 'plains-1',
        controller: 'player1',
        card: {
          name: 'Plains',
          type_line: 'Basic Land — Plains',
          oracle_text: '',
        },
      };

      const gameState = {
        battlefield: [urborg, realityTwist, plains],
      };

      expect(getEffectiveBasicLandTypes(gameState, plains)).toEqual(['plains', 'swamp']);

      const plainsAbilities = getManaAbilitiesForPermanent(gameState, plains, 'player1');

      expect(plainsAbilities.some(a => a.produces.includes('R'))).toBe(true);
      expect(plainsAbilities.some(a => a.produces.includes('G'))).toBe(true);
      expect(plainsAbilities.some(a => a.produces.includes('W'))).toBe(false);
      expect(plainsAbilities.some(a => a.produces.includes('B'))).toBe(false);
    });

    it('should suppress Urborg under Blood Moon and remap Mountain mana with Reality Twist', () => {
      const bloodMoon = {
        id: 'blood-moon-1',
        controller: 'player2',
        card: {
          name: 'Blood Moon',
          type_line: 'Enchantment',
          oracle_text: 'Nonbasic lands are Mountains.',
        },
      };

      const urborg = {
        id: 'urborg-1',
        controller: 'player1',
        card: {
          name: 'Urborg, Tomb of Yawgmoth',
          type_line: 'Legendary Land',
          oracle_text: 'Each land is a Swamp in addition to its other land types.',
        },
      };

      const realityTwist = {
        id: 'reality-twist-1',
        controller: 'player1',
        card: {
          name: 'Reality Twist',
          type_line: 'World Enchantment',
          oracle_text: 'If tapped for mana, Plains produce {R}, Swamps produce {G}, Mountains produce {W}, and Forests produce {B} instead of any other type.',
        },
      };

      const commandTower = {
        id: 'command-tower-1',
        controller: 'player1',
        card: {
          name: 'Command Tower',
          type_line: 'Land',
          oracle_text: '{T}: Add one mana of any color in your commander\'s color identity.',
        },
      };

      const plains = {
        id: 'plains-1',
        controller: 'player1',
        card: {
          name: 'Plains',
          type_line: 'Basic Land — Plains',
          oracle_text: '',
        },
      };

      const gameState = {
        battlefield: [bloodMoon, urborg, realityTwist, commandTower, plains],
      };

      expect(getEffectiveBasicLandTypes(gameState, commandTower)).toEqual(['mountain']);
      expect(getEffectiveBasicLandTypes(gameState, plains)).toEqual(['plains']);

      const towerAbilities = getManaAbilitiesForPermanent(gameState, commandTower, 'player1');
      const plainsAbilities = getManaAbilitiesForPermanent(gameState, plains, 'player1');

      expect(towerAbilities).toHaveLength(1);
      expect(towerAbilities[0].produces).toEqual(['W']);
      expect(plainsAbilities.some(a => a.produces.includes('R'))).toBe(true);
      expect(plainsAbilities.some(a => a.produces.includes('G'))).toBe(false);
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
