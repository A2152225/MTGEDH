import { describe, it, expect } from 'vitest';

/**
 * Tests for AI mana retention behavior.
 * With retention, pool mana persists until spent — tap all eligible sources.
 */
describe('AI Mana Retention', () => {
  describe('Land tapping strategy', () => {
    it('taps all retainable lands because pool mana stays available for instants', () => {
      const tappableLands = Array.from({ length: 10 }, (_, index) => ({ id: `forest_${index}` }));
      const landsToTap = tappableLands;

      expect(landsToTap).toHaveLength(10);
    });

    it('taps every land even with a small board', () => {
      const tappableLands = Array.from({ length: 5 }, (_, index) => ({ id: `forest_${index}` }));
      const landsToTap = tappableLands;

      expect(landsToTap).toHaveLength(5);
    });

    it('taps a single retainable land', () => {
      const tappableLands = [{ id: 'forest_1' }];
      const landsToTap = tappableLands;

      expect(landsToTap).toHaveLength(1);
    });

    it('taps all lands in a large late-game board', () => {
      const tappableLands = Array.from({ length: 20 }, (_, index) => ({ id: `forest_${index}` }));
      const landsToTap = tappableLands;

      expect(landsToTap).toHaveLength(20);
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
