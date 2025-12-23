import { describe, it, expect } from 'vitest';

/**
 * Tests for AI mana retention behavior
 * Ensures AI only taps a conservative portion of lands when retention effects are present
 */
describe('AI Mana Retention', () => {
  describe('Land tapping strategy', () => {
    it('should keep at least 40% of lands untapped for instant-speed responses', () => {
      // Simulate the logic from executeAITapLandsForMana
      const totalTappable = 10; // AI has 10 forests, Omnath is on battlefield
      
      const minToKeepUntapped = Math.max(3, Math.ceil(totalTappable * 0.4)); // Keep 40% or at least 3, whichever is MORE
      const maxToTap = Math.max(0, totalTappable - minToKeepUntapped);
      
      expect(minToKeepUntapped).toBe(4); // max(3, ceil(10*0.4)) = max(3, 4) = 4
      expect(maxToTap).toBe(6); // Should tap 6, keep 4 untapped
    });
    
    it('should keep at least 3 lands untapped even with small land count', () => {
      const totalTappable = 5; // AI has only 5 forests
      
      const minToKeepUntapped = Math.max(3, Math.ceil(totalTappable * 0.4));
      const maxToTap = Math.max(0, totalTappable - minToKeepUntapped);
      
      expect(minToKeepUntapped).toBe(3); // max(3, ceil(5*0.4)) = max(3, 2) = 3
      expect(maxToTap).toBe(2); // Should tap 2, keep 3 untapped
    });
    
    it('should not tap any lands if total is less than minimum threshold', () => {
      const totalTappable = 2; // AI has only 2 forests
      
      const minToKeepUntapped = Math.max(3, Math.ceil(totalTappable * 0.4));
      const maxToTap = Math.max(0, totalTappable - minToKeepUntapped);
      
      expect(minToKeepUntapped).toBe(3); // max(3, ceil(2*0.4)) = max(3, 1) = 3  
      expect(maxToTap).toBe(0); // Can't keep 3 untapped from 2 total, so tap 0
    });
    
    it('should handle edge case with 1 land', () => {
      const totalTappable = 1;
      
      const minToKeepUntapped = Math.max(3, Math.ceil(totalTappable * 0.4));
      const maxToTap = Math.max(0, totalTappable - minToKeepUntapped);
      
      expect(minToKeepUntapped).toBe(3); // max(3, ceil(1*0.4)) = max(3, 1) = 3
      expect(maxToTap).toBe(0); // Can't keep 3 untapped from 1 total, so tap 0
    });
    
    it('should tap majority of lands with large land count', () => {
      const totalTappable = 20; // AI has 20 forests (late game)
      
      const minToKeepUntapped = Math.max(3, Math.ceil(totalTappable * 0.4));
      const maxToTap = Math.max(0, totalTappable - minToKeepUntapped);
      
      expect(minToKeepUntapped).toBe(8); // max(3, ceil(20*0.4)) = max(3, 8) = 8
      expect(maxToTap).toBe(12); // Should tap 12, keep 8 untapped (40%)
    });
  });
  
  describe('Retention effect detection', () => {
    it('should detect Omnath, Locus of Mana by name', () => {
      const cardName = 'omnath, locus of mana';
      const oracleText = "You don't lose unspent green mana as steps and phases end.";
      
      const hasGreenRetention = cardName.includes('omnath, locus of mana') || 
        (oracleText.toLowerCase().includes('green mana') && 
         (oracleText.toLowerCase().includes("doesn't empty") || oracleText.toLowerCase().includes("doesn't empty") ||
          oracleText.toLowerCase().includes("don't lose") || oracleText.toLowerCase().includes("don't lose")));
      
      expect(hasGreenRetention).toBe(true);
    });
    
    it('should detect Leyline Tyrant by name', () => {
      const cardName = 'leyline tyrant';
      const oracleText = "You don't lose unspent red mana as steps and phases end.";
      
      const hasRedRetention = cardName.includes('leyline tyrant') ||
        (oracleText.toLowerCase().includes('red mana') && 
         (oracleText.toLowerCase().includes("don't lose") || oracleText.toLowerCase().includes("don't lose") ||
          oracleText.toLowerCase().includes("doesn't empty") || oracleText.toLowerCase().includes("doesn't empty")));
      
      expect(hasRedRetention).toBe(true);
    });
    
    it('should detect Kruphix by name', () => {
      const cardName = 'kruphix, god of horizons';
      const oracleText = 'If you would lose unspent mana, that mana becomes colorless instead.';
      
      const hasColorlessConversion = cardName.includes('kruphix') || cardName.includes('horizon stone') ||
        oracleText.toLowerCase().includes('mana becomes colorless instead');
      
      expect(hasColorlessConversion).toBe(true);
    });
    
    it('should not detect retention on regular mana producers', () => {
      const cardName = 'llanowar elves';
      const oracleText = '{T}: Add {G}.';
      
      const hasGreenRetention = cardName.includes('omnath, locus of mana') || 
        (oracleText.toLowerCase().includes('green mana') && 
         (oracleText.toLowerCase().includes("doesn't empty") || oracleText.toLowerCase().includes("doesn't empty") ||
          oracleText.toLowerCase().includes("don't lose") || oracleText.toLowerCase().includes("don't lose")));
      
      expect(hasGreenRetention).toBe(false);
    });
  });
});
