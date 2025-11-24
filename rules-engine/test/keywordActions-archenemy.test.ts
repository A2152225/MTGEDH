/**
 * Tests for Archenemy Keyword Actions
 * 
 * Tests keyword actions specific to Archenemy format:
 * - Set in Motion (Rule 701.32)
 * - Abandon (Rule 701.33)
 */

import { describe, it, expect } from 'vitest';
import {
  // Rule 701.32: Set in Motion
  canSetInMotion,
  setInMotion,
  SET_IN_MOTION_ONE_AT_A_TIME,
  setMultipleSchemesInMotion,
  createSetInMotionResult,
  isSchemeInMotion,
  
  // Rule 701.33: Abandon
  canAbandon,
  abandon,
  createAbandonResult,
  isOngoingScheme,
  validateAbandonState,
} from '../src/keywordActions';

describe('Archenemy Keyword Actions', () => {
  describe('Rule 701.32: Set in Motion', () => {
    it('should only work in Archenemy game (Rule 701.32a)', () => {
      expect(canSetInMotion(true, true, true)).toBe(true);
      expect(canSetInMotion(false, true, true)).toBe(false); // Not Archenemy game
      expect(canSetInMotion(true, false, true)).toBe(false); // Not archenemy
      expect(canSetInMotion(true, true, false)).toBe(false); // Not scheme card
    });
    
    it('should set a scheme in motion (Rule 701.32b)', () => {
      const action = setInMotion('scheme1', 'archenemy1');
      
      expect(action.type).toBe('set-in-motion');
      expect(action.schemeId).toBe('scheme1');
      expect(action.archenenemyId).toBe('archenemy1');
    });
    
    it('should set schemes one at a time (Rule 701.32c)', () => {
      expect(SET_IN_MOTION_ONE_AT_A_TIME).toBe(true);
      
      const actions = setMultipleSchemesInMotion(
        ['scheme1', 'scheme2', 'scheme3'],
        'archenemy1'
      );
      
      expect(actions).toHaveLength(3);
      expect(actions[0].schemeId).toBe('scheme1');
      expect(actions[1].schemeId).toBe('scheme2');
      expect(actions[2].schemeId).toBe('scheme3');
    });
    
    it('should create set in motion result', () => {
      const result = createSetInMotionResult('scheme1', true, true);
      
      expect(result.schemeId).toBe('scheme1');
      expect(result.wasOnTopOfDeck).toBe(true);
      expect(result.wasFaceDown).toBe(true);
      expect(result.movedOffDeck).toBe(true); // Was on top
      expect(result.turnedFaceUp).toBe(true); // Was face down
    });
    
    it('should handle scheme already face up', () => {
      const result = createSetInMotionResult('scheme1', false, false);
      
      expect(result.movedOffDeck).toBe(false); // Wasn't on top
      expect(result.turnedFaceUp).toBe(false); // Already face up
    });
    
    it('should check if scheme is in motion', () => {
      expect(isSchemeInMotion(true)).toBe(true);
      expect(isSchemeInMotion(false)).toBe(false);
    });
  });
  
  describe('Rule 701.33: Abandon', () => {
    it('should only abandon face-up ongoing schemes (Rule 701.33a)', () => {
      expect(canAbandon(true, true, true)).toBe(true);
      expect(canAbandon(false, true, true)).toBe(false); // Not Archenemy game
      expect(canAbandon(true, false, true)).toBe(false); // Not face up
      expect(canAbandon(true, true, false)).toBe(false); // Not ongoing
    });
    
    it('should abandon a scheme (Rule 701.33b)', () => {
      const action = abandon('scheme1', 'player1');
      
      expect(action.type).toBe('abandon');
      expect(action.schemeId).toBe('scheme1');
      expect(action.ownerId).toBe('player1');
    });
    
    it('should create abandon result', () => {
      const result = createAbandonResult('scheme1');
      
      expect(result.schemeId).toBe('scheme1');
      expect(result.turnedFaceDown).toBe(true);
      expect(result.movedToBottomOfDeck).toBe(true);
    });
    
    it('should identify ongoing schemes', () => {
      expect(isOngoingScheme('ongoing')).toBe(true);
      expect(isOngoingScheme('non-ongoing')).toBe(false);
    });
    
    it('should validate abandon state', () => {
      const validScheme = {
        isFaceUp: true,
        isOngoing: true,
        isArchenemyGame: true,
      };
      
      const result = validateAbandonState(validScheme);
      expect(result.canAbandon).toBe(true);
      expect(result.reason).toBeUndefined();
    });
    
    it('should reject abandoning if not in Archenemy game', () => {
      const notArchenemy = {
        isFaceUp: true,
        isOngoing: true,
        isArchenemyGame: false,
      };
      
      const result = validateAbandonState(notArchenemy);
      expect(result.canAbandon).toBe(false);
      expect(result.reason).toBe('Not an Archenemy game');
    });
    
    it('should reject abandoning face-down scheme', () => {
      const faceDown = {
        isFaceUp: false,
        isOngoing: true,
        isArchenemyGame: true,
      };
      
      const result = validateAbandonState(faceDown);
      expect(result.canAbandon).toBe(false);
      expect(result.reason).toBe('Scheme is not face up');
    });
    
    it('should reject abandoning non-ongoing scheme', () => {
      const nonOngoing = {
        isFaceUp: true,
        isOngoing: false,
        isArchenemyGame: true,
      };
      
      const result = validateAbandonState(nonOngoing);
      expect(result.canAbandon).toBe(false);
      expect(result.reason).toBe('Scheme is not ongoing');
    });
  });
  
  describe('Archenemy Integration', () => {
    it('should support full scheme lifecycle', () => {
      // Set a scheme in motion
      const setMotion = setInMotion('scheme1', 'archenemy1');
      expect(setMotion.type).toBe('set-in-motion');
      
      // Scheme is now in motion (face up)
      expect(isSchemeInMotion(true)).toBe(true);
      
      // If it's ongoing, it can be abandoned
      const canAbandonNow = canAbandon(true, true, true);
      expect(canAbandonNow).toBe(true);
      
      // Abandon the scheme
      const abandonAction = abandon('scheme1', 'archenemy1');
      expect(abandonAction.type).toBe('abandon');
    });
    
    it('should handle multiple schemes set in motion', () => {
      const schemes = ['scheme1', 'scheme2', 'scheme3'];
      const actions = setMultipleSchemesInMotion(schemes, 'archenemy1');
      
      expect(actions).toHaveLength(3);
      actions.forEach((action, index) => {
        expect(action.schemeId).toBe(schemes[index]);
        expect(action.archenenemyId).toBe('archenemy1');
      });
    });
  });
});
