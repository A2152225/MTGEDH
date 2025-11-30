/**
 * Shared utility functions for parsing text
 */

/**
 * Word to number mapping for parsing oracle text
 * Supports common English number words used in Magic cards
 */
export const WORD_TO_NUMBER: Readonly<Record<string, number>> = {
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
  'a': 1, 'an': 1,
};

/**
 * Parse a number from text (supports both numeric and word forms)
 * @param text The text to parse (e.g., "three", "10", "a")
 * @param defaultValue Value to return if parsing fails (default: 1)
 * @returns The parsed number
 */
export function parseNumberFromText(text: string, defaultValue: number = 1): number {
  const lower = text.toLowerCase().trim();
  
  if (WORD_TO_NUMBER[lower] !== undefined) {
    return WORD_TO_NUMBER[lower];
  }
  
  const num = parseInt(text, 10);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Types of permanents that can be sacrificed
 */
export type SacrificeType = 'creature' | 'artifact' | 'enchantment' | 'land' | 'permanent' | 'self';

/**
 * Result of parsing sacrifice requirements from a cost string
 */
export interface SacrificeCostInfo {
  requiresSacrifice: boolean;
  sacrificeType?: SacrificeType;
  sacrificeCount?: number;
}

/**
 * Parse sacrifice requirements from a cost string
 * Detects patterns like "Sacrifice a creature", "Sacrifice an artifact", etc.
 * 
 * @param costStr The cost portion of an activated ability (e.g., "Sacrifice a creature")
 * @returns Information about the sacrifice requirement
 */
export function parseSacrificeCost(costStr: string): SacrificeCostInfo {
  const lowerCost = costStr.toLowerCase();
  
  if (!/\bsacrifice\b/i.test(costStr)) {
    return { requiresSacrifice: false };
  }
  
  const result: SacrificeCostInfo = { requiresSacrifice: true };
  
  // "Sacrifice ~" or "sacrifice this" = sacrifice self
  if (lowerCost.includes('sacrifice ~') || lowerCost.includes('sacrifice this')) {
    result.sacrificeType = 'self';
    return result;
  }
  
  // "Sacrifice a/an X" patterns
  if (/sacrifice\s+(?:a|an)\s+creature/i.test(lowerCost)) {
    result.sacrificeType = 'creature';
  } else if (/sacrifice\s+(?:a|an)\s+artifact/i.test(lowerCost)) {
    result.sacrificeType = 'artifact';
  } else if (/sacrifice\s+(?:a|an)\s+enchantment/i.test(lowerCost)) {
    result.sacrificeType = 'enchantment';
  } else if (/sacrifice\s+(?:a|an)\s+land/i.test(lowerCost)) {
    result.sacrificeType = 'land';
  } else if (/sacrifice\s+(?:a|an)\s+permanent/i.test(lowerCost)) {
    result.sacrificeType = 'permanent';
  }
  
  // "Sacrifice X creatures/artifacts/etc" (multiple)
  if (/sacrifice\s+(\d+|two|three|four|five)\s+creatures?/i.test(lowerCost)) {
    result.sacrificeType = 'creature';
    const countMatch = lowerCost.match(/sacrifice\s+(\d+|two|three|four|five)\s+creatures?/i);
    if (countMatch) {
      result.sacrificeCount = parseNumberFromText(countMatch[1]);
    }
  }
  
  return result;
}
