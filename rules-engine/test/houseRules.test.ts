/**
 * House Rules Tests
 * 
 * Tests for optional house rules that can be enabled during pregame.
 * These rules are commonly used in casual Commander games.
 */

import { describe, it, expect } from 'vitest';
import type { HouseRules, GameState, KnownCardRef } from '../../shared/src/types';

// Helper to create a mock hand with specific land/non-land distribution
function createMockHand(landCount: number, nonLandCount: number): KnownCardRef[] {
  const hand: KnownCardRef[] = [];
  
  for (let i = 0; i < landCount; i++) {
    hand.push({
      id: `land_${i}`,
      name: `Forest ${i}`,
      type_line: 'Basic Land — Forest',
    });
  }
  
  for (let i = 0; i < nonLandCount; i++) {
    hand.push({
      id: `spell_${i}`,
      name: `Lightning Bolt ${i}`,
      type_line: 'Instant',
    });
  }
  
  return hand;
}

// Helper to check if a hand qualifies for no lands/all lands free mulligan
function handHasNoLandsOrAllLands(hand: KnownCardRef[]): boolean {
  if (!Array.isArray(hand) || hand.length === 0) return false;
  
  let landCount = 0;
  for (const card of hand) {
    if (!card) continue;
    const typeLine = (card.type_line || '').toLowerCase();
    if (/\bland\b/.test(typeLine)) {
      landCount++;
    }
  }
  
  return landCount === 0 || landCount === hand.length;
}

// Helper to calculate effective mulligan count
function calculateEffectiveMulliganCount(
  actualMulligans: number,
  houseRules: HouseRules,
  isMultiplayer: boolean,
  allHumansMulliganed: boolean
): number {
  if (actualMulligans === 0) return 0;
  
  let effectiveCount = actualMulligans;
  
  // Free first mulligan in multiplayer
  if (houseRules.freeFirstMulligan && isMultiplayer && actualMulligans >= 1) {
    effectiveCount = Math.max(0, actualMulligans - 1);
  }
  
  // Group mulligan discount
  if (houseRules.groupMulliganDiscount && allHumansMulliganed) {
    effectiveCount = Math.max(0, effectiveCount - 1);
  }
  
  return effectiveCount;
}

describe('House Rules', () => {
  describe('handHasNoLandsOrAllLands', () => {
    it('returns true for hand with no lands', () => {
      const hand = createMockHand(0, 7);
      expect(handHasNoLandsOrAllLands(hand)).toBe(true);
    });
    
    it('returns true for hand with all lands', () => {
      const hand = createMockHand(7, 0);
      expect(handHasNoLandsOrAllLands(hand)).toBe(true);
    });
    
    it('returns false for hand with mixed cards', () => {
      const hand = createMockHand(3, 4);
      expect(handHasNoLandsOrAllLands(hand)).toBe(false);
    });
    
    it('returns false for hand with one land', () => {
      const hand = createMockHand(1, 6);
      expect(handHasNoLandsOrAllLands(hand)).toBe(false);
    });
    
    it('returns false for hand with one non-land', () => {
      const hand = createMockHand(6, 1);
      expect(handHasNoLandsOrAllLands(hand)).toBe(false);
    });
    
    it('returns false for empty hand', () => {
      expect(handHasNoLandsOrAllLands([])).toBe(false);
    });
  });
  
  describe('Free First Mulligan in Multiplayer', () => {
    it('gives free first mulligan in 4-player game', () => {
      const houseRules: HouseRules = { freeFirstMulligan: true };
      const result = calculateEffectiveMulliganCount(1, houseRules, true, false);
      expect(result).toBe(0); // First mulligan is free
    });
    
    it('second mulligan costs 1 card in multiplayer', () => {
      const houseRules: HouseRules = { freeFirstMulligan: true };
      const result = calculateEffectiveMulliganCount(2, houseRules, true, false);
      expect(result).toBe(1); // 2 - 1 = 1
    });
    
    it('third mulligan costs 2 cards in multiplayer', () => {
      const houseRules: HouseRules = { freeFirstMulligan: true };
      const result = calculateEffectiveMulliganCount(3, houseRules, true, false);
      expect(result).toBe(2); // 3 - 1 = 2
    });
    
    it('does not give free mulligan in 2-player game', () => {
      const houseRules: HouseRules = { freeFirstMulligan: true };
      const result = calculateEffectiveMulliganCount(1, houseRules, false, false);
      expect(result).toBe(1); // No free mulligan in 2-player
    });
    
    it('no effect when rule is disabled', () => {
      const houseRules: HouseRules = { freeFirstMulligan: false };
      const result = calculateEffectiveMulliganCount(1, houseRules, true, false);
      expect(result).toBe(1);
    });
  });
  
  describe('Group Mulligan Discount', () => {
    it('gives discount when all human players mulligan', () => {
      const houseRules: HouseRules = { groupMulliganDiscount: true };
      const result = calculateEffectiveMulliganCount(2, houseRules, true, true);
      expect(result).toBe(1); // 2 - 1 = 1
    });
    
    it('no discount when not all humans mulligan', () => {
      const houseRules: HouseRules = { groupMulliganDiscount: true };
      const result = calculateEffectiveMulliganCount(2, houseRules, true, false);
      expect(result).toBe(2);
    });
    
    it('stacks with free first mulligan', () => {
      const houseRules: HouseRules = { 
        freeFirstMulligan: true, 
        groupMulliganDiscount: true 
      };
      // 2 mulligans: -1 for free first, -1 for group = 0 cards to put back
      const result = calculateEffectiveMulliganCount(2, houseRules, true, true);
      expect(result).toBe(0);
    });
    
    it('cannot go below 0', () => {
      const houseRules: HouseRules = { 
        freeFirstMulligan: true, 
        groupMulliganDiscount: true 
      };
      const result = calculateEffectiveMulliganCount(1, houseRules, true, true);
      expect(result).toBe(0); // Cannot be negative
    });
  });
  
  describe('Multiple Rules Enabled', () => {
    it('allows all mulligan rules to be enabled simultaneously', () => {
      const houseRules: HouseRules = {
        freeFirstMulligan: true,
        freeMulliganNoLandsOrAllLands: true,
        groupMulliganDiscount: true,
      };
      
      // All rules can be enabled at once
      expect(houseRules.freeFirstMulligan).toBe(true);
      expect(houseRules.freeMulliganNoLandsOrAllLands).toBe(true);
      expect(houseRules.groupMulliganDiscount).toBe(true);
    });
    
    it('allows commander damage rule with mulligan rules', () => {
      const houseRules: HouseRules = {
        freeFirstMulligan: true,
        anyCommanderDamageCountsAsCommanderDamage: true,
      };
      
      expect(houseRules.freeFirstMulligan).toBe(true);
      expect(houseRules.anyCommanderDamageCountsAsCommanderDamage).toBe(true);
    });
    
    it('allows variant formats to be enabled with other rules', () => {
      const houseRules: HouseRules = {
        freeFirstMulligan: true,
        enableArchenemy: true,
        enablePlanechase: true,
      };
      
      expect(houseRules.freeFirstMulligan).toBe(true);
      expect(houseRules.enableArchenemy).toBe(true);
      expect(houseRules.enablePlanechase).toBe(true);
    });
  });
  
  describe('HouseRules in GameState', () => {
    it('can store house rules in game state', () => {
      const gameState: Partial<GameState> = {
        id: 'test_game',
        houseRules: {
          freeFirstMulligan: true,
          freeMulliganNoLandsOrAllLands: true,
        },
      };
      
      expect(gameState.houseRules?.freeFirstMulligan).toBe(true);
      expect(gameState.houseRules?.freeMulliganNoLandsOrAllLands).toBe(true);
      expect(gameState.houseRules?.groupMulliganDiscount).toBeUndefined();
    });
    
    it('defaults to undefined when no house rules set', () => {
      const gameState: Partial<GameState> = {
        id: 'test_game',
      };
      
      expect(gameState.houseRules).toBeUndefined();
    });
  });
});
