/**
 * Tests for control change mechanics (Humble Defector, Act of Treason, etc.)
 * Validates that permanents can change control between players
 */

import { describe, it, expect } from 'vitest';
import type { PlayerID, BattlefieldPermanent } from '../../shared/src/types';
import { ACTIVATED_ABILITY_CARDS, hasSpecialActivatedAbility } from '../src/cards/activatedAbilityCards';

describe('Control Change Mechanics', () => {
  describe('Permanent Control Changes', () => {
    it('should change control of permanent to target opponent', () => {
      const p1 = 'p1' as PlayerID;
      const p2 = 'p2' as PlayerID;
      
      const humbleDefector: BattlefieldPermanent = {
        id: 'defector_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'defector_1',
          name: 'Humble Defector',
          type_line: 'Creature — Human Rogue',
          oracle_text: '{T}: Draw two cards. Target opponent gains control of Humble Defector. Activate only during your turn.',
          mana_cost: '{1}{R}',
          power: '2',
          toughness: '1',
        },
        tapped: false,
        summoningSickness: false,
        counters: {},
      };
      
      // Verify initial state
      expect(humbleDefector.controller).toBe(p1);
      
      // Simulate control change
      humbleDefector.controller = p2;
      
      // Verify control changed
      expect(humbleDefector.controller).toBe(p2);
      expect(humbleDefector.owner).toBe(p1); // Owner should remain unchanged
    });
    
    it('should keep original owner when control changes', () => {
      const p1 = 'p1' as PlayerID;
      const p2 = 'p2' as PlayerID;
      
      const creature: BattlefieldPermanent = {
        id: 'creature_1',
        controller: p1,
        owner: p1,
        card: { 
          id: 'creature_1', 
          name: 'Grizzly Bears', 
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
        tapped: false,
        counters: {},
      };
      
      const originalOwner = creature.owner;
      
      // Change control
      creature.controller = p2;
      
      // Owner should not change
      expect(creature.owner).toBe(originalOwner);
      expect(creature.controller).toBe(p2);
    });
    
    it('should handle multiple control changes', () => {
      const p1 = 'p1' as PlayerID;
      const p2 = 'p2' as PlayerID;
      const p3 = 'p3' as PlayerID;
      
      const creature: BattlefieldPermanent = {
        id: 'creature_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'creature_1',
          name: 'Test Creature',
          type_line: 'Creature',
          oracle_text: '',
        },
        tapped: false,
        counters: {},
      };
      
      // First control change: p1 -> p2
      creature.controller = p2;
      expect(creature.controller).toBe(p2);
      
      // Second control change: p2 -> p3
      creature.controller = p3;
      expect(creature.controller).toBe(p3);
      
      // Third control change: back to original controller p1
      creature.controller = p1;
      expect(creature.controller).toBe(p1);
      
      // Owner should remain unchanged through all changes
      expect(creature.owner).toBe(p1);
    });
  });
  
  describe('Activated Ability Registry', () => {
    it('should have Humble Defector in activated ability cards registry', () => {
      // Check if Humble Defector is registered
      expect(hasSpecialActivatedAbility('Humble Defector')).toBe(true);
      
      // Check configuration
      const config = ACTIVATED_ABILITY_CARDS['humble defector'];
      expect(config).toBeDefined();
      expect(config.cardName).toBe('Humble Defector');
      expect(config.tapAbility).toBeDefined();
      expect(config.tapAbility?.targetType).toBe('opponent');
      expect(config.tapAbility?.controlChange).toBe(true);
      expect(config.tapAbility?.timingRestriction).toBe('your_turn');
    });
  });
});
