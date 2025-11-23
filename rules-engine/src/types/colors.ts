/**
 * Rule 105: Colors
 * Type definitions for the five colors in Magic
 */

// Rule 105.1 - There are five colors in the Magic game
export enum Color {
  WHITE = 'white',
  BLUE = 'blue',
  BLACK = 'black',
  RED = 'red',
  GREEN = 'green'
}

// Rule 105.2a - A monocolored object is exactly one color
export type MonoColor = Color;

// Rule 105.2b - A multicolored object is two or more colors
export type MultiColor = Color[];

// Rule 105.2c - A colorless object has no color
export type ColorlessObject = { colorless: true };

// An object can be one or more colors, or no color at all (Rule 105.2)
export type ObjectColor = Color[] | ColorlessObject;

// Rule 105.5 - Color pairs (exactly two colors)
export type ColorPair = [Color, Color];

// All valid color pairs (Rule 105.5)
export const COLOR_PAIRS: readonly ColorPair[] = [
  [Color.WHITE, Color.BLUE],    // Azorius
  [Color.WHITE, Color.BLACK],   // Orzhov
  [Color.BLUE, Color.BLACK],    // Dimir
  [Color.BLUE, Color.RED],      // Izzet
  [Color.BLACK, Color.RED],     // Rakdos
  [Color.BLACK, Color.GREEN],   // Golgari
  [Color.RED, Color.GREEN],     // Gruul
  [Color.RED, Color.WHITE],     // Boros
  [Color.GREEN, Color.WHITE],   // Selesnya
  [Color.GREEN, Color.BLUE]     // Simic
] as const;

/**
 * Helper functions for color operations
 */

// Rule 105.2a - Check if object is monocolored
export function isMonocolored(colors: ObjectColor): boolean {
  return Array.isArray(colors) && colors.length === 1;
}

// Rule 105.2b - Check if object is multicolored
export function isMulticolored(colors: ObjectColor): boolean {
  return Array.isArray(colors) && colors.length >= 2;
}

// Rule 105.2c - Check if object is colorless
export function isColorless(colors: ObjectColor): boolean {
  return !Array.isArray(colors) || colors.length === 0;
}

// Get colors as array (empty array for colorless)
export function getColors(colors: ObjectColor): Color[] {
  if (Array.isArray(colors)) {
    return colors;
  }
  return [];
}

// Rule 105.3 - Change object's color (new color replaces all previous unless "in addition")
export function setColor(newColor: Color, additive: boolean = false, currentColors?: ObjectColor): ObjectColor {
  if (additive && currentColors && Array.isArray(currentColors)) {
    // Add to existing colors
    if (!currentColors.includes(newColor)) {
      return [...currentColors, newColor];
    }
    return currentColors;
  }
  // Replace all previous colors
  return [newColor];
}

// Rule 105.3 - Make colored object colorless
export function makeColorless(): ColorlessObject {
  return { colorless: true };
}
