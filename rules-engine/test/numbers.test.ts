/**
 * Tests for Rule 107: Numbers and Symbols
 */
import { describe, it, expect } from 'vitest';
import {
  isValidGameNumber,
  normalizeToZero,
  parseManaSymbols,
  calculateManaValue
} from '../src/types/numbers';

describe('Rule 107: Numbers and Symbols', () => {
  describe('Rule 107.1 - Integers only', () => {
    it('should validate integers as valid game numbers', () => {
      expect(isValidGameNumber(0)).toBe(true);
      expect(isValidGameNumber(5)).toBe(true);
      expect(isValidGameNumber(-3)).toBe(true);
      expect(isValidGameNumber(100)).toBe(true);
    });

    it('should reject fractional numbers', () => {
      expect(isValidGameNumber(1.5)).toBe(false);
      expect(isValidGameNumber(0.1)).toBe(false);
      expect(isValidGameNumber(2.99)).toBe(false);
    });
  });

  describe('Rule 107.1b - Negative values normalize to zero', () => {
    it('should normalize negative values to zero', () => {
      expect(normalizeToZero(-5)).toBe(0);
      expect(normalizeToZero(-1)).toBe(0);
      expect(normalizeToZero(0)).toBe(0);
    });

    it('should keep positive values unchanged', () => {
      expect(normalizeToZero(5)).toBe(5);
      expect(normalizeToZero(10)).toBe(10);
    });
  });

  describe('Rule 107.4 - Mana symbols', () => {
    it('should parse single colored mana symbols', () => {
      expect(parseManaSymbols('{W}')).toEqual(['{W}']);
      expect(parseManaSymbols('{U}')).toEqual(['{U}']);
      expect(parseManaSymbols('{B}')).toEqual(['{B}']);
      expect(parseManaSymbols('{R}')).toEqual(['{R}']);
      expect(parseManaSymbols('{G}')).toEqual(['{G}']);
    });

    it('should parse generic mana symbols', () => {
      expect(parseManaSymbols('{1}')).toEqual(['{1}']);
      expect(parseManaSymbols('{3}')).toEqual(['{3}']);
      expect(parseManaSymbols('{10}')).toEqual(['{10}']);
    });

    it('should parse hybrid mana symbols', () => {
      expect(parseManaSymbols('{W/U}')).toEqual(['{W/U}']);
      expect(parseManaSymbols('{2/B}')).toEqual(['{2/B}']);
    });

    it('should parse complete mana costs', () => {
      const cost = '{2}{U}{U}';
      const symbols = parseManaSymbols(cost);
      expect(symbols).toHaveLength(3);
      expect(symbols).toContain('{2}');
      expect(symbols).toContain('{U}');
    });

    it('should parse complex mana costs', () => {
      const cost = '{X}{W}{W}{B}';
      const symbols = parseManaSymbols(cost);
      expect(symbols).toHaveLength(4);
      expect(symbols).toContain('{X}');
      expect(symbols).toContain('{W}');
      expect(symbols).toContain('{B}');
    });
  });

  describe('Mana value calculation', () => {
    it('should calculate mana value for generic costs', () => {
      expect(calculateManaValue(['{3}'])).toBe(3);
      expect(calculateManaValue(['{5}'])).toBe(5);
    });

    it('should calculate mana value for colored costs', () => {
      expect(calculateManaValue(['{W}'])).toBe(1);
      expect(calculateManaValue(['{U}', '{U}'])).toBe(2);
    });

    it('should calculate mana value for mixed costs', () => {
      const symbols = parseManaSymbols('{2}{U}{U}');
      expect(calculateManaValue(symbols)).toBe(4);
    });

    it('should handle X costs with provided value', () => {
      const symbols = parseManaSymbols('{X}{W}{W}');
      expect(calculateManaValue(symbols, 5)).toBe(7); // X=5 + W + W
      expect(calculateManaValue(symbols, 0)).toBe(2); // X=0 + W + W
    });

    it('should count hybrid costs as 1', () => {
      const symbols = parseManaSymbols('{W/U}{B}');
      expect(calculateManaValue(symbols)).toBe(2);
    });

    it('should calculate mana value for real card examples', () => {
      // Counterspell: {U}{U}
      expect(calculateManaValue(parseManaSymbols('{U}{U}'))).toBe(2);
      
      // Lightning Bolt: {R}
      expect(calculateManaValue(parseManaSymbols('{R}'))).toBe(1);
      
      // Wrath of God: {2}{W}{W}
      expect(calculateManaValue(parseManaSymbols('{2}{W}{W}'))).toBe(4);
      
      // Emrakul: {15}
      expect(calculateManaValue(parseManaSymbols('{15}'))).toBe(15);
    });
  });
});
