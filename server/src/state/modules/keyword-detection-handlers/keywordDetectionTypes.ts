// server/src/state/modules/keyword-detection-handlers/keywordDetectionTypes.ts
// Origin parent: server/src/state/modules/keyword-detection.ts
// Cluster moved: KeywordCategory, KeywordTiming, DetectedKeyword, KeywordDetectionResult, KeywordPattern.
// Public entry symbols: KeywordCategory, KeywordTiming, DetectedKeyword, KeywordDetectionResult.
// KeywordPattern is internal to the pattern tables.

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Categories of keyword abilities
 */
export type KeywordCategory = 
  | 'triggered'      // Triggers on specific events (e.g., prowess, dethrone)
  | 'static'         // Always active (e.g., flying, deathtouch)
  | 'activated'      // Requires activation (e.g., equip, cycling)
  | 'replacement'    // Modifies events (e.g., undying, persist)
  | 'cost_modifier'  // Modifies costs (e.g., affinity, convoke)
  | 'enters_effect'; // ETB modifications (e.g., bloodthirst, sunburst)

/**
 * When the keyword triggers
 */
export type KeywordTiming =
  | 'cast'              // When you cast a spell
  | 'etb'               // Enters the battlefield
  | 'ltb'               // Leaves the battlefield
  | 'dies'              // When creature dies
  | 'attacks'           // When creature attacks
  | 'blocks'            // When creature blocks
  | 'combat_damage'     // Deals combat damage
  | 'any_damage'        // Deals any damage
  | 'upkeep'            // At beginning of upkeep
  | 'end_step'          // At beginning of end step
  | 'draw'              // When a card is drawn
  | 'discard'           // When a card is discarded
  | 'creature_etb'      // When another creature ETB
  | 'noncreature_cast'  // When noncreature spell cast
  | 'opponent_attacks'  // When opponent's creature attacks
  | 'always';           // Static, always active

/**
 * Detected keyword from oracle text
 */
export interface DetectedKeyword {
  keyword: string;           // Keyword name (lowercase)
  category: KeywordCategory;
  timing: KeywordTiming;
  value?: number;            // Numeric value if any (e.g., annihilator 4)
  valueType?: string;        // Type of value (e.g., 'counters', 'damage', 'mana')
  condition?: string;        // Trigger condition if any
  effect: string;            // Effect description
  mandatory: boolean;        // Is the effect mandatory?
  requiresChoice?: boolean;  // Does it require player choice?
  choiceType?: string;       // Type of choice required
  raw?: string;              // Raw matched text
}

/**
 * Result of keyword detection
 */
export interface KeywordDetectionResult {
  keywords: DetectedKeyword[];
  hasTriggeredAbilities: boolean;
  hasStaticAbilities: boolean;
  hasActivatedAbilities: boolean;
  hasReplacementEffects: boolean;
  hasCostModifiers: boolean;
}

// ============================================================================
// Keyword Pattern Definitions
// ============================================================================

/**
 * Pattern definitions for keyword abilities
 * Each pattern extracts the keyword and optionally a numeric value
 */
export interface KeywordPattern {
  pattern: RegExp;
  keyword: string;
  category: KeywordCategory;
  timing: KeywordTiming;
  valueType?: string;
  effect: (match: RegExpMatchArray, cardName: string) => string;
  mandatory?: boolean;
  requiresChoice?: boolean;
  choiceType?: string;
}
