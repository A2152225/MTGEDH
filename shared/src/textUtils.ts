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
export type SacrificeType = 'creature' | 'artifact' | 'enchantment' | 'land' | 'permanent' | 'self' | 'artifact_or_creature';

/**
 * Result of parsing sacrifice requirements from a cost string
 */
export interface SacrificeCostInfo {
  requiresSacrifice: boolean;
  sacrificeType?: SacrificeType;
  sacrificeCount?: number;
  /**
   * For creature subtypes like Soldier, Goblin, etc.
   * If set, the sacrifice must be a creature of this subtype.
   * This is used for cards like "Sacrifice a Soldier" or "Sacrifice a Goblin".
   */
  creatureSubtype?: string;
  /**
   * Whether the sacrifice must be "other" permanents (not the source itself)
   * Example: "Sacrifice two other artifacts and/or creatures"
   */
  mustBeOther?: boolean;
}

/**
 * Parse sacrifice requirements from a cost string
 * Detects patterns like "Sacrifice a creature", "Sacrifice an artifact", etc.
 * Also handles creature subtypes like "Sacrifice a Soldier".
 * Handles compound types like "artifacts and/or creatures".
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
  
  // Check for "other" modifier (e.g., "Sacrifice two other artifacts")
  result.mustBeOther = /sacrifice\s+(?:\d+|one|two|three|four|five|an?)\s+other\b/i.test(lowerCost);
  
  // "Sacrifice ~" or "sacrifice this" = sacrifice self
  if (lowerCost.includes('sacrifice ~') || lowerCost.includes('sacrifice this')) {
    result.sacrificeType = 'self';
    return result;
  }
  
  // Handle compound types: "artifacts and/or creatures" (Mondrak, Dominus pattern)
  // Pattern structure:
  //   - "sacrifice" keyword
  //   - count: number (1-5) or "a/an"
  //   - optional "other" modifier
  //   - type combination: "artifacts and/or creatures" OR "creatures and/or artifacts"
  // Examples: "Sacrifice two other artifacts and/or creatures"
  const artifactOrCreatureMatch = lowerCost.match(
    /sacrifice\s+(\d+|one|two|three|four|five|an?)\s+(?:other\s+)?(?:artifacts?\s+and\/or\s+creatures?|creatures?\s+and\/or\s+artifacts?)/i
  );
  if (artifactOrCreatureMatch) {
    result.sacrificeType = 'artifact_or_creature';
    result.sacrificeCount = parseNumberFromText(artifactOrCreatureMatch[1]);
    return result;
  }
  
  // "Sacrifice a/an X" patterns - first check for permanent types
  if (/sacrifice\s+(?:a|an)\s+creature\b/i.test(lowerCost)) {
    result.sacrificeType = 'creature';
  } else if (/sacrifice\s+(?:a|an)\s+artifact\b/i.test(lowerCost)) {
    result.sacrificeType = 'artifact';
  } else if (/sacrifice\s+(?:a|an)\s+enchantment\b/i.test(lowerCost)) {
    result.sacrificeType = 'enchantment';
  } else if (/sacrifice\s+(?:a|an)\s+land\b/i.test(lowerCost)) {
    result.sacrificeType = 'land';
  } else if (/sacrifice\s+(?:a|an)\s+permanent\b/i.test(lowerCost)) {
    result.sacrificeType = 'permanent';
  } else {
    // Check for creature subtypes dynamically using regex
    // Pattern: "Sacrifice a/an [Subtype]" where Subtype is a capitalized word
    // Examples: "Sacrifice a Soldier", "Sacrifice a Goblin", "Sacrifice an Elf"
    const subtypeMatch = costStr.match(/sacrifice\s+(?:a|an)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i);
    if (subtypeMatch) {
      const potentialSubtype = subtypeMatch[1].trim();
      // Verify it's not a card type (case-insensitive check)
      const cardTypes = ['creature', 'artifact', 'enchantment', 'land', 'permanent', 'planeswalker', 'instant', 'sorcery'];
      if (!cardTypes.includes(potentialSubtype.toLowerCase())) {
        // This is a creature subtype
        result.sacrificeType = 'creature';
        result.creatureSubtype = potentialSubtype;
      }
    }
  }
  
  // "Sacrifice X creatures/artifacts/etc" (multiple)
  if (/sacrifice\s+(\d+|two|three|four|five)\s+(?:other\s+)?creatures?/i.test(lowerCost)) {
    result.sacrificeType = 'creature';
    const countMatch = lowerCost.match(/sacrifice\s+(\d+|two|three|four|five)\s+(?:other\s+)?creatures?/i);
    if (countMatch) {
      result.sacrificeCount = parseNumberFromText(countMatch[1]);
    }
  }
  
  // "Sacrifice X artifacts" (multiple)
  if (/sacrifice\s+(\d+|two|three|four|five)\s+(?:other\s+)?artifacts?/i.test(lowerCost)) {
    result.sacrificeType = 'artifact';
    const countMatch = lowerCost.match(/sacrifice\s+(\d+|two|three|four|five)\s+(?:other\s+)?artifacts?/i);
    if (countMatch) {
      result.sacrificeCount = parseNumberFromText(countMatch[1]);
    }
  }
  
  return result;
}
