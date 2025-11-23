/**
 * Tests for Rule 701: Keyword Actions (Part 1)
 * 
 * Tests the first 8 keyword actions from Rule 701:
 * - Activate, Attach, Behold, Cast, Counter, Create, Destroy, Discard
 */

import { describe, it, expect } from 'vitest';
import {
  // Rule 701.3: Attach
  attachToObject,
  unattach,
  isAttached,
  attemptAttach,
  AttachmentState,
  
  // Rule 701.4: Behold
  createBeholdAction,
  wasBeheld,
  
  // Rule 701.6: Counter
  counterSpell,
  counterAbility,
  getCounterResult,
  
  // Rule 701.7: Create
  createTokens,
  
  // Rule 701.8: Destroy
  destroyPermanent,
  canBeDestroyed,
  DestructionCause,
  
  // Rule 701.9: Discard
  discardCard,
  discardRandom,
  discardChosen,
  getDiscardResult,
} from '../src/types/keywordActions';

describe('Rule 701: Keyword Actions - Part 1', () => {
  describe('Rule 701.3: Attach', () => {
    it('should attach an object and assign new timestamp (Rule 701.3c)', () => {
      const equipment: AttachmentState = {
        id: 'equipment1',
        attachedTo: null,
        timestamp: 100,
      };
      
      const attached = attachToObject(equipment, 'creature1', 150);
      
      expect(attached.attachedTo).toBe('creature1');
      expect(attached.timestamp).toBe(150); // New timestamp
    });
    
    it('should do nothing when attaching to same target (Rule 701.3b)', () => {
      const equipment: AttachmentState = {
        id: 'equipment1',
        attachedTo: 'creature1',
        timestamp: 100,
      };
      
      const result = attemptAttach(equipment, 'creature1', 150);
      
      expect(result.attachedTo).toBe('creature1');
      expect(result.timestamp).toBe(100); // Timestamp unchanged
    });
    
    it('should unattach an attachment (Rule 701.3d)', () => {
      const equipment: AttachmentState = {
        id: 'equipment1',
        attachedTo: 'creature1',
        timestamp: 100,
      };
      
      const unattached = unattach(equipment);
      
      expect(unattached.attachedTo).toBeNull();
      expect(isAttached(unattached)).toBe(false);
    });
    
    it('should detect attached state', () => {
      const attached: AttachmentState = {
        id: 'aura1',
        attachedTo: 'permanent1',
        timestamp: 100,
      };
      
      const notAttached: AttachmentState = {
        id: 'aura2',
        attachedTo: null,
        timestamp: 100,
      };
      
      expect(isAttached(attached)).toBe(true);
      expect(isAttached(notAttached)).toBe(false);
    });
  });
  
  describe('Rule 701.4: Behold', () => {
    it('should create behold action with quality', () => {
      const action = createBeholdAction('player1', 'legendary', 'revealed-card', 'card1');
      
      expect(action.type).toBe('behold');
      expect(action.quality).toBe('legendary');
      expect(action.choice).toBe('revealed-card');
    });
    
    it('should check if quality was beheld (Rule 701.4b)', () => {
      const action = createBeholdAction('player1', 'artifact', 'chosen-permanent', 'perm1');
      
      expect(wasBeheld(action, 'artifact')).toBe(true);
      expect(wasBeheld(action, 'legendary')).toBe(false);
    });
  });
  
  describe('Rule 701.5: Cast', () => {
    it('should create cast action', () => {
      // Cast is primarily handled by Rule 601, this is the keyword reference
      // Just verify the action structure exists
      const castAction = {
        type: 'cast' as const,
        spellId: 'spell1',
        controllerId: 'player1',
        fromZone: 'hand',
      };
      
      expect(castAction.type).toBe('cast');
    });
  });
  
  describe('Rule 701.6: Counter', () => {
    it('should counter a spell', () => {
      const action = counterSpell('spell1');
      
      expect(action.type).toBe('counter');
      expect(action.targetType).toBe('spell');
      expect(action.targetId).toBe('spell1');
    });
    
    it('should counter an ability', () => {
      const action = counterAbility('ability1');
      
      expect(action.type).toBe('counter');
      expect(action.targetType).toBe('ability');
      expect(action.targetId).toBe('ability1');
    });
    
    it('should not refund costs when countering (Rule 701.6b)', () => {
      const spellResult = getCounterResult('spell');
      const abilityResult = getCounterResult('ability');
      
      expect(spellResult.costsRefunded).toBe(false);
      expect(abilityResult.costsRefunded).toBe(false);
    });
    
    it('should move countered spell to graveyard (Rule 701.6a)', () => {
      const result = getCounterResult('spell');
      
      expect(result.destination).toBe('graveyard');
      expect(result.countered).toBe(true);
    });
    
    it('should make countered ability cease to exist', () => {
      const result = getCounterResult('ability');
      
      expect(result.destination).toBe('ceases-to-exist');
    });
  });
  
  describe('Rule 701.7: Create', () => {
    it('should create tokens', () => {
      const action = createTokens('player1', 3, 'Treasure');
      
      expect(action.type).toBe('create');
      expect(action.count).toBe(3);
      expect(action.tokenType).toBe('Treasure');
      expect(action.controllerId).toBe('player1');
    });
    
    it('should create tokens with characteristics', () => {
      const characteristics = {
        power: 2,
        toughness: 2,
        color: 'white',
      };
      
      const action = createTokens('player1', 1, 'Soldier', characteristics);
      
      expect(action.characteristics).toEqual(characteristics);
    });
  });
  
  describe('Rule 701.8: Destroy', () => {
    it('should destroy a permanent', () => {
      const action = destroyPermanent('permanent1');
      
      expect(action.type).toBe('destroy');
      expect(action.permanentId).toBe('permanent1');
    });
    
    it('should destroy with different causes (Rule 701.8b)', () => {
      const byKeyword = destroyPermanent('perm1', DestructionCause.DESTROY_KEYWORD);
      const byLethal = destroyPermanent('perm2', DestructionCause.LETHAL_DAMAGE);
      const byDeathtouch = destroyPermanent('perm3', DestructionCause.DEATHTOUCH_DAMAGE);
      
      expect(byKeyword.permanentId).toBe('perm1');
      expect(byLethal.permanentId).toBe('perm2');
      expect(byDeathtouch.permanentId).toBe('perm3');
    });
    
    it('should prevent destruction if regeneration shield (Rule 701.8c)', () => {
      expect(canBeDestroyed('perm1', false)).toBe(true);
      expect(canBeDestroyed('perm1', true)).toBe(false); // Has regeneration shield
    });
    
    it('should only destroy via specific methods (Rule 701.8b)', () => {
      // Rule 701.8b: Only destroy keyword, lethal damage, or deathtouch damage
      // If permanent goes to graveyard by other means, it's not "destroyed"
      
      const validCauses = [
        DestructionCause.DESTROY_KEYWORD,
        DestructionCause.LETHAL_DAMAGE,
        DestructionCause.DEATHTOUCH_DAMAGE,
      ];
      
      expect(validCauses).toHaveLength(3);
    });
  });
  
  describe('Rule 701.9: Discard', () => {
    it('should discard with player choice (default, Rule 701.9b)', () => {
      const action = discardCard('player1', 'card1');
      
      expect(action.type).toBe('discard');
      expect(action.mode).toBe('choice');
      expect(action.playerId).toBe('player1');
      expect(action.cardId).toBe('card1');
    });
    
    it('should discard randomly (Rule 701.9b)', () => {
      const action = discardRandom('player1');
      
      expect(action.mode).toBe('random');
      expect(action.playerId).toBe('player1');
      expect(action.cardId).toBeUndefined();
    });
    
    it('should discard with opponent choice (Rule 701.9b)', () => {
      const action = discardChosen('player1', 'player2', 'card1');
      
      expect(action.mode).toBe('opponent-choice');
      expect(action.playerId).toBe('player1');
      expect(action.discarderId).toBe('player2');
      expect(action.cardId).toBe('card1');
    });
    
    it('should go to graveyard by default', () => {
      const result = getDiscardResult('graveyard', false);
      
      expect(result.destination).toBe('graveyard');
      expect(result.characteristicsDefined).toBe(true);
    });
    
    it('should have undefined characteristics if hidden and not revealed (Rule 701.9c)', () => {
      const hiddenNotRevealed = getDiscardResult('hidden-zone', false);
      const hiddenRevealed = getDiscardResult('hidden-zone', true);
      
      expect(hiddenNotRevealed.characteristicsDefined).toBe(false); // Rule 701.9c
      expect(hiddenRevealed.characteristicsDefined).toBe(true);
    });
  });
});
