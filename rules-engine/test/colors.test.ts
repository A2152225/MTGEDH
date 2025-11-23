/**
 * Tests for Rule 105: Colors
 */
import { describe, it, expect } from 'vitest';
import {
  Color,
  isMonocolored,
  isMulticolored,
  isColorless,
  getColors,
  setColor,
  makeColorless,
  COLOR_PAIRS
} from '../src/types/colors';

describe('Rule 105: Colors', () => {
  describe('Rule 105.1 - Five colors', () => {
    it('should have exactly five colors defined', () => {
      const colors = Object.values(Color);
      expect(colors).toHaveLength(5);
      expect(colors).toContain('white');
      expect(colors).toContain('blue');
      expect(colors).toContain('black');
      expect(colors).toContain('red');
      expect(colors).toContain('green');
    });
  });

  describe('Rule 105.2a - Monocolored objects', () => {
    it('should identify monocolored objects correctly', () => {
      expect(isMonocolored([Color.WHITE])).toBe(true);
      expect(isMonocolored([Color.BLUE])).toBe(true);
      expect(isMonocolored([Color.WHITE, Color.BLUE])).toBe(false);
      expect(isMonocolored([])).toBe(false);
      expect(isMonocolored({ colorless: true })).toBe(false);
    });
  });

  describe('Rule 105.2b - Multicolored objects', () => {
    it('should identify multicolored objects correctly', () => {
      expect(isMulticolored([Color.WHITE, Color.BLUE])).toBe(true);
      expect(isMulticolored([Color.BLACK, Color.RED, Color.GREEN])).toBe(true);
      expect(isMulticolored([Color.WHITE])).toBe(false);
      expect(isMulticolored([])).toBe(false);
    });
  });

  describe('Rule 105.2c - Colorless objects', () => {
    it('should identify colorless objects correctly', () => {
      expect(isColorless({ colorless: true })).toBe(true);
      expect(isColorless([])).toBe(true);
      expect(isColorless([Color.WHITE])).toBe(false);
      expect(isColorless([Color.WHITE, Color.BLUE])).toBe(false);
    });
  });

  describe('Rule 105.3 - Changing colors', () => {
    it('should replace all previous colors by default', () => {
      const original = [Color.WHITE, Color.BLUE];
      const result = setColor(Color.RED, false, original);
      expect(result).toEqual([Color.RED]);
    });

    it('should add color when additive is true', () => {
      const original = [Color.WHITE];
      const result = setColor(Color.BLUE, true, original);
      expect(getColors(result)).toContain(Color.WHITE);
      expect(getColors(result)).toContain(Color.BLUE);
    });

    it('should make objects colorless', () => {
      const result = makeColorless();
      expect(isColorless(result)).toBe(true);
    });
  });

  describe('Rule 105.5 - Color pairs', () => {
    it('should have exactly 10 color pairs', () => {
      expect(COLOR_PAIRS).toHaveLength(10);
    });

    it('should have all valid color pairs', () => {
      // Each color should appear in exactly 4 pairs
      const colorCounts = new Map<Color, number>();
      for (const pair of COLOR_PAIRS) {
        for (const color of pair) {
          colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
        }
      }
      
      for (const color of Object.values(Color)) {
        expect(colorCounts.get(color as Color)).toBe(4);
      }
    });
  });
});
