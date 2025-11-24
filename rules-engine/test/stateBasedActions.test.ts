/**
 * Tests for Rule 704: State-Based Actions
 * 
 * Tests the automatic game actions that occur when certain conditions are met.
 */

import { describe, it, expect } from 'vitest';
import {
  StateBasedActionType,
  checkPlayerLife,
  checkEmptyLibraryDraw,
  checkPoisonCounters,
  checkTokenZone,
  checkCopyZone,
  checkCreatureToughness,
  checkLethalDamage,
  checkDeathtouchDamage,
  checkPlaneswalkerLoyalty,
  checkLegendRule,
  checkWorldRule,
  checkAuraAttachment,
  checkEquipmentAttachment,
  checkCounterCancellation,
  checkBattleDefense,
  checkCommanderDamage,
  STATE_BASED_ACTIONS_DONT_USE_STACK,
  STATE_BASED_ACTIONS_IGNORE_RESOLUTION,
} from '../src/stateBasedActions';

describe('Rule 704: State-Based Actions', () => {
  describe('Rule 704.5a: Zero or less life', () => {
    it('should detect player with 0 life', () => {
      const action = checkPlayerLife('player1', 0);
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.PLAYER_ZERO_LIFE);
      expect(action?.affectedObjectIds).toContain('player1');
    });
    
    it('should detect player with negative life', () => {
      const action = checkPlayerLife('player1', -5);
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.PLAYER_ZERO_LIFE);
    });
    
    it('should not trigger for positive life', () => {
      const action = checkPlayerLife('player1', 1);
      
      expect(action).toBeNull();
    });
  });
  
  describe('Rule 704.5b: Empty library draw', () => {
    it('should detect draw from empty library', () => {
      const action = checkEmptyLibraryDraw('player1', true);
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.PLAYER_LIBRARY_EMPTY);
      expect(action?.affectedObjectIds).toContain('player1');
    });
    
    it('should not trigger if no draw attempted', () => {
      const action = checkEmptyLibraryDraw('player1', false);
      
      expect(action).toBeNull();
    });
  });
  
  describe('Rule 704.5c: Poison counters', () => {
    it('should detect 10 poison counters', () => {
      const action = checkPoisonCounters('player1', 10);
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.PLAYER_POISON);
    });
    
    it('should detect more than 10 poison counters', () => {
      const action = checkPoisonCounters('player1', 15);
      
      expect(action).not.toBeNull();
    });
    
    it('should not trigger for less than 10', () => {
      const action = checkPoisonCounters('player1', 9);
      
      expect(action).toBeNull();
    });
  });
  
  describe('Rule 704.5d: Token in wrong zone', () => {
    it('should detect token not on battlefield', () => {
      const inGraveyard = checkTokenZone('token1', 'graveyard');
      const inExile = checkTokenZone('token2', 'exile');
      const inHand = checkTokenZone('token3', 'hand');
      
      expect(inGraveyard).not.toBeNull();
      expect(inExile).not.toBeNull();
      expect(inHand).not.toBeNull();
    });
    
    it('should not trigger for token on battlefield', () => {
      const action = checkTokenZone('token1', 'battlefield');
      
      expect(action).toBeNull();
    });
  });
  
  describe('Rule 704.5e: Copy in wrong zone', () => {
    it('should detect spell copy not on stack', () => {
      const action = checkCopyZone('copy1', 'spell', 'graveyard');
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.COPY_NOT_IN_VALID_ZONE);
    });
    
    it('should allow spell copy on stack', () => {
      const action = checkCopyZone('copy1', 'spell', 'stack');
      
      expect(action).toBeNull();
    });
    
    it('should detect card copy in invalid zone', () => {
      const inGraveyard = checkCopyZone('copy1', 'card', 'graveyard');
      const inHand = checkCopyZone('copy2', 'card', 'hand');
      
      expect(inGraveyard).not.toBeNull();
      expect(inHand).not.toBeNull();
    });
    
    it('should allow card copy on stack or battlefield', () => {
      const onStack = checkCopyZone('copy1', 'card', 'stack');
      const onBattlefield = checkCopyZone('copy2', 'card', 'battlefield');
      
      expect(onStack).toBeNull();
      expect(onBattlefield).toBeNull();
    });
  });
  
  describe('Rule 704.5f: Creature zero toughness', () => {
    it('should detect creature with 0 toughness', () => {
      const action = checkCreatureToughness('creature1', 0);
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.CREATURE_ZERO_TOUGHNESS);
    });
    
    it('should detect creature with negative toughness', () => {
      const action = checkCreatureToughness('creature1', -2);
      
      expect(action).not.toBeNull();
    });
    
    it('should not trigger for positive toughness', () => {
      const action = checkCreatureToughness('creature1', 1);
      
      expect(action).toBeNull();
    });
  });
  
  describe('Rule 704.5g: Lethal damage', () => {
    it('should detect lethal damage', () => {
      const action = checkLethalDamage('creature1', 3, 3);
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.CREATURE_LETHAL_DAMAGE);
    });
    
    it('should detect more than lethal damage', () => {
      const action = checkLethalDamage('creature1', 3, 5);
      
      expect(action).not.toBeNull();
    });
    
    it('should not trigger for damage less than toughness', () => {
      const action = checkLethalDamage('creature1', 3, 2);
      
      expect(action).toBeNull();
    });
    
    it('should not trigger for 0 toughness (handled by Rule 704.5f)', () => {
      const action = checkLethalDamage('creature1', 0, 1);
      
      expect(action).toBeNull();
    });
  });
  
  describe('Rule 704.5h: Deathtouch damage', () => {
    it('should detect deathtouch damage', () => {
      const action = checkDeathtouchDamage('creature1', 5, true);
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.CREATURE_DEATHTOUCH_DAMAGE);
    });
    
    it('should not trigger without deathtouch damage', () => {
      const action = checkDeathtouchDamage('creature1', 5, false);
      
      expect(action).toBeNull();
    });
    
    it('should not trigger for 0 toughness', () => {
      const action = checkDeathtouchDamage('creature1', 0, true);
      
      expect(action).toBeNull();
    });
  });
  
  describe('Rule 704.5i: Planeswalker zero loyalty', () => {
    it('should detect planeswalker with 0 loyalty', () => {
      const action = checkPlaneswalkerLoyalty('planeswalker1', 0);
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.PLANESWALKER_ZERO_LOYALTY);
    });
    
    it('should not trigger for positive loyalty', () => {
      const action = checkPlaneswalkerLoyalty('planeswalker1', 1);
      
      expect(action).toBeNull();
    });
  });
  
  describe('Rule 704.5j: Legend rule', () => {
    it('should detect duplicate legendary permanents', () => {
      const permanents = [
        { id: 'legend1', name: 'Jace Beleren', controllerId: 'player1' },
        { id: 'legend2', name: 'Jace Beleren', controllerId: 'player1' },
      ];
      
      const action = checkLegendRule(permanents);
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.LEGEND_RULE);
      expect(action?.affectedObjectIds).toHaveLength(2);
    });
    
    it('should not trigger for different legendary permanents', () => {
      const permanents = [
        { id: 'legend1', name: 'Jace Beleren', controllerId: 'player1' },
        { id: 'legend2', name: 'Liliana Vess', controllerId: 'player1' },
      ];
      
      const action = checkLegendRule(permanents);
      
      expect(action).toBeNull();
    });
    
    it('should not trigger for same name controlled by different players', () => {
      const permanents = [
        { id: 'legend1', name: 'Jace Beleren', controllerId: 'player1' },
        { id: 'legend2', name: 'Jace Beleren', controllerId: 'player2' },
      ];
      
      const action = checkLegendRule(permanents);
      
      expect(action).toBeNull();
    });
  });
  
  describe('Rule 704.5k: World rule', () => {
    it('should detect multiple world permanents', () => {
      const worlds = [
        { id: 'world1', timestamp: 100 },
        { id: 'world2', timestamp: 200 },
        { id: 'world3', timestamp: 150 },
      ];
      
      const action = checkWorldRule(worlds);
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.WORLD_RULE);
      expect(action?.affectedObjectIds).toContain('world1');
      expect(action?.affectedObjectIds).toContain('world3');
      expect(action?.affectedObjectIds).not.toContain('world2'); // Newest
    });
    
    it('should not trigger for single world', () => {
      const worlds = [{ id: 'world1', timestamp: 100 }];
      
      const action = checkWorldRule(worlds);
      
      expect(action).toBeNull();
    });
  });
  
  describe('Rule 704.5m: Aura illegal attachment', () => {
    it('should detect aura not attached', () => {
      const action = checkAuraAttachment('aura1', null, false);
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.AURA_ILLEGAL_ATTACHMENT);
    });
    
    it('should detect aura illegally attached', () => {
      const action = checkAuraAttachment('aura1', 'target1', false);
      
      expect(action).not.toBeNull();
    });
    
    it('should not trigger for legally attached aura', () => {
      const action = checkAuraAttachment('aura1', 'target1', true);
      
      expect(action).toBeNull();
    });
  });
  
  describe('Rule 704.5n: Equipment illegal attachment', () => {
    it('should detect equipment illegally attached', () => {
      const action = checkEquipmentAttachment('equipment1', 'target1', false);
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.EQUIPMENT_ILLEGAL_ATTACHMENT);
    });
    
    it('should not trigger for unattached equipment', () => {
      const action = checkEquipmentAttachment('equipment1', null, false);
      
      expect(action).toBeNull();
    });
    
    it('should not trigger for legally attached equipment', () => {
      const action = checkEquipmentAttachment('equipment1', 'target1', true);
      
      expect(action).toBeNull();
    });
  });
  
  describe('Rule 704.5q: Counter cancellation', () => {
    it('should detect +1/+1 and -1/-1 counters', () => {
      const action = checkCounterCancellation('permanent1', 3, 2);
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.COUNTER_CANCELLATION);
    });
    
    it('should not trigger with only +1/+1 counters', () => {
      const action = checkCounterCancellation('permanent1', 3, 0);
      
      expect(action).toBeNull();
    });
    
    it('should not trigger with only -1/-1 counters', () => {
      const action = checkCounterCancellation('permanent1', 0, 2);
      
      expect(action).toBeNull();
    });
  });
  
  describe('Rule 704.5v: Battle zero defense', () => {
    it('should detect battle with 0 defense', () => {
      const action = checkBattleDefense('battle1', 0, false);
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.BATTLE_ZERO_DEFENSE);
    });
    
    it('should not trigger if triggered ability on stack', () => {
      const action = checkBattleDefense('battle1', 0, true);
      
      expect(action).toBeNull();
    });
    
    it('should not trigger for positive defense', () => {
      const action = checkBattleDefense('battle1', 1, false);
      
      expect(action).toBeNull();
    });
  });
  
  describe('Rule 704.6c: Commander damage', () => {
    it('should detect 21 commander damage', () => {
      const damage = new Map([['commander1', 21]]);
      const action = checkCommanderDamage('player1', damage);
      
      expect(action).not.toBeNull();
      expect(action?.type).toBe(StateBasedActionType.COMMANDER_DAMAGE);
      expect(action?.affectedObjectIds).toContain('player1');
      expect(action?.affectedObjectIds).toContain('commander1');
    });
    
    it('should detect more than 21 commander damage', () => {
      const damage = new Map([['commander1', 25]]);
      const action = checkCommanderDamage('player1', damage);
      
      expect(action).not.toBeNull();
    });
    
    it('should not trigger for less than 21 damage', () => {
      const damage = new Map([['commander1', 20]]);
      const action = checkCommanderDamage('player1', damage);
      
      expect(action).toBeNull();
    });
    
    it('should track damage per commander separately', () => {
      const damage = new Map([
        ['commander1', 15],
        ['commander2', 10],
      ]);
      const action = checkCommanderDamage('player1', damage);
      
      expect(action).toBeNull();
    });
  });
  
  describe('Rule 704.1 and 704.4: General properties', () => {
    it('should confirm state-based actions don\'t use stack', () => {
      expect(STATE_BASED_ACTIONS_DONT_USE_STACK).toBe(true);
    });
    
    it('should confirm state-based actions ignore resolution', () => {
      expect(STATE_BASED_ACTIONS_IGNORE_RESOLUTION).toBe(true);
    });
  });
});
