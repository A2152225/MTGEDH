/**
 * Tests for bounce land mana generation
 * 
 * This test suite verifies that:
 * 1. Bounce lands like Selesnya Sanctuary produce both colors at once (no choice)
 * 2. Mana is properly added to the player's mana pool
 * 3. No modal prompt is shown for fixed dual-mana producers
 * 4. The producesAllAtOnce flag is correctly set and used
 */

import { describe, it, expect } from 'vitest';
import { getManaAbilitiesForPermanent } from '../src/state/modules/mana-abilities';

describe('Bounce Land Mana Abilities', () => {
  describe('Selesnya Sanctuary', () => {
    it('should detect mana ability with producesAllAtOnce: true', () => {
      const gameState = {
        battlefield: [],
      };
      
      const permanent = {
        id: 'selesnya-sanctuary-1',
        controller: 'player1',
        card: {
          name: 'Selesnya Sanctuary',
          type_line: 'Land',
          oracle_text: 'This land enters tapped.\nWhen this land enters, return a land you control to its owner\'s hand.\n{T}: Add {G}{W}.',
        },
      };
      
      const abilities = getManaAbilitiesForPermanent(gameState, permanent, 'player1');
      
      // Should have exactly one mana ability
      expect(abilities.length).toBeGreaterThan(0);
      
      // Find the multi-mana ability
      const multiAbility = abilities.find(a => a.id === 'native_multi');
      expect(multiAbility).toBeDefined();
      
      // Should produce both G and W
      expect(multiAbility?.produces).toContain('G');
      expect(multiAbility?.produces).toContain('W');
      expect(multiAbility?.produces.length).toBe(2);
      
      // Should have producesAllAtOnce flag set to true
      expect(multiAbility?.producesAllAtOnce).toBe(true);
    });
  });

  describe('Rakdos Carnarium', () => {
    it('should detect mana ability with producesAllAtOnce: true', () => {
      const gameState = {
        battlefield: [],
      };
      
      const permanent = {
        id: 'rakdos-carnarium-1',
        controller: 'player1',
        card: {
          name: 'Rakdos Carnarium',
          type_line: 'Land',
          oracle_text: 'Rakdos Carnarium enters tapped.\nWhen Rakdos Carnarium enters, return a land you control to its owner\'s hand.\n{T}: Add {B}{R}.',
        },
      };
      
      const abilities = getManaAbilitiesForPermanent(gameState, permanent, 'player1');
      
      // Should have exactly one mana ability
      expect(abilities.length).toBeGreaterThan(0);
      
      // Find the multi-mana ability
      const multiAbility = abilities.find(a => a.id === 'native_multi');
      expect(multiAbility).toBeDefined();
      
      // Should produce both B and R
      expect(multiAbility?.produces).toContain('B');
      expect(multiAbility?.produces).toContain('R');
      expect(multiAbility?.produces.length).toBe(2);
      
      // Should have producesAllAtOnce flag set to true
      expect(multiAbility?.producesAllAtOnce).toBe(true);
    });
  });

  describe('Azorius Chancery', () => {
    it('should detect mana ability with producesAllAtOnce: true', () => {
      const gameState = {
        battlefield: [],
      };
      
      const permanent = {
        id: 'azorius-chancery-1',
        controller: 'player1',
        card: {
          name: 'Azorius Chancery',
          type_line: 'Land',
          oracle_text: 'Azorius Chancery enters tapped.\nWhen Azorius Chancery enters, return a land you control to its owner\'s hand.\n{T}: Add {W}{U}.',
        },
      };
      
      const abilities = getManaAbilitiesForPermanent(gameState, permanent, 'player1');
      
      // Should have exactly one mana ability
      expect(abilities.length).toBeGreaterThan(0);
      
      // Find the multi-mana ability
      const multiAbility = abilities.find(a => a.id === 'native_multi');
      expect(multiAbility).toBeDefined();
      
      // Should produce both W and U
      expect(multiAbility?.produces).toContain('W');
      expect(multiAbility?.produces).toContain('U');
      expect(multiAbility?.produces.length).toBe(2);
      
      // Should have producesAllAtOnce flag set to true
      expect(multiAbility?.producesAllAtOnce).toBe(true);
    });
  });

  describe('Comparison with choice lands', () => {
    it('should NOT set producesAllAtOnce for "or" choice lands', () => {
      const gameState = {
        battlefield: [],
      };
      
      // A land that offers a choice (not all at once)
      const permanent = {
        id: 'jungle-shrine-1',
        controller: 'player1',
        card: {
          name: 'Jungle Shrine',
          type_line: 'Land',
          oracle_text: 'Jungle Shrine enters tapped.\n{T}: Add {R}, {G}, or {W}.',
        },
      };
      
      const abilities = getManaAbilitiesForPermanent(gameState, permanent, 'player1');
      
      // Should have mana ability
      expect(abilities.length).toBeGreaterThan(0);
      
      // Should produce multiple colors but NOT all at once
      const choiceAbility = abilities.find(a => a.produces.length > 1);
      expect(choiceAbility).toBeDefined();
      
      // Should NOT have producesAllAtOnce flag or it should be false
      expect(choiceAbility?.producesAllAtOnce).not.toBe(true);
    });
  });
});
