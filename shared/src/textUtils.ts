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
