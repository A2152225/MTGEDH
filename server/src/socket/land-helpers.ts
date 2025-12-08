/**
 * land-helpers.ts
 * 
 * Helper functions for land card processing in game actions.
 * 
 * This module contains:
 * - Land type detection (shock lands, bounce lands, etc.)
 * - ETB (Enter the Battlefield) pattern detection
 * - Conditional land entry logic
 * - Additional cost detection for spells
 */

// ============================================================================
// Additional Cost Detection
// ============================================================================

/**
 * Result of detecting additional spell costs.
 * 
 * Used to describe what extra cost a player must pay when casting certain spells.
 * Examples include discarding cards (Faithless Looting), sacrificing permanents,
 * or paying life.
 * 
 * @property type - The type of additional cost required ('discard', 'sacrifice', 'pay_life', or 'squad')
 * @property amount - How many of the cost type must be paid (e.g., 1 card, 2 life)
 * @property filter - Optional filter for sacrifice costs (e.g., "creature", "artifact")
 * @property cost - For squad: the mana cost to pay per copy (e.g., "{1}{W}")
 * @property canPayMultipleTimes - For squad: indicates the cost can be paid any number of times
 */
export interface AdditionalCostResult {
  type: 'discard' | 'sacrifice' | 'pay_life' | 'squad';
  amount: number;
  filter?: string;
  cost?: string;
  canPayMultipleTimes?: boolean;
}

/**
 * Detect if a spell/permanent has additional costs like "discard a card" or "sacrifice a creature"
 * Returns the additional cost requirement if found.
 * 
 * This handles Seize the Spoils, Faithless Looting, Squad, and similar cards.
 * Pattern: "As an additional cost to cast this spell, discard a card"
 * Squad pattern: "Squad [cost]" which means "As an additional cost to cast this spell, you may pay [cost] any number of times"
 */
export function detectAdditionalCost(oracleText: string): AdditionalCostResult | null {
  const lowerText = (oracleText || "").toLowerCase();
  
  // Squad: "Squad {cost}" - Rule 702.157
  // This is an additional cost that can be paid any number of times
  // Pattern: "Squad {X}{Y}" or "Squad — {cost}"
  const squadMatch = oracleText.match(/\bSquad\s+[—\-]?\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (squadMatch) {
    return {
      type: 'squad',
      amount: 0, // Will be determined by player choice
      cost: squadMatch[1].trim(),
      canPayMultipleTimes: true,
    };
  }
  
  // "As an additional cost to cast this spell, discard a card"
  const discardMatch = lowerText.match(/as an additional cost.*discard\s+(?:a|(\d+))\s+cards?/i);
  if (discardMatch) {
    return {
      type: 'discard',
      amount: discardMatch[1] ? parseInt(discardMatch[1], 10) : 1,
    };
  }
  
  // "As an additional cost to cast this spell, sacrifice a creature"
  const sacrificeMatch = lowerText.match(/as an additional cost.*sacrifice\s+(?:a|an)\s+(\w+(?:\s+or\s+\w+)?)/i);
  if (sacrificeMatch) {
    return {
      type: 'sacrifice',
      amount: 1,
      filter: sacrificeMatch[1].trim(),
    };
  }
  
  // "As an additional cost to cast this spell, pay X life"
  const payLifeMatch = lowerText.match(/as an additional cost.*pay\s+(\d+)\s+life/i);
  if (payLifeMatch) {
    return {
      type: 'pay_life',
      amount: parseInt(payLifeMatch[1], 10),
    };
  }
  
  return null;
}

// ============================================================================
// Land Type Sets
// ============================================================================

/** Shock lands and similar "pay life or enter tapped" lands */
export const SHOCK_LANDS = new Set([
  "blood crypt",
  "breeding pool",
  "godless shrine",
  "hallowed fountain",
  "overgrown tomb",
  "sacred foundry",
  "steam vents",
  "stomping ground",
  "temple garden",
  "watery grave",
]);

/**
 * List of bounce lands (karoo lands / aqueducts) that return a land to hand
 * These tap for 2 mana of different colors and enter tapped
 */
export const BOUNCE_LANDS = new Set([
  // Ravnica bounce lands
  "azorius chancery", "boros garrison", "dimir aqueduct", "golgari rot farm",
  "gruul turf", "izzet boilerworks", "orzhov basilica", "rakdos carnarium",
  "selesnya sanctuary", "simic growth chamber",
  // Commander/other bounce lands
  "coral atoll", "dormant volcano", "everglades", "jungle basin", "karoo",
  // Guildless commons
  "guildless commons"
]);

// ============================================================================
// Land Type Detection
// ============================================================================

/** Check if a card name is a shock land */
export function isShockLand(cardName: string): boolean {
  return SHOCK_LANDS.has((cardName || "").toLowerCase().trim());
}

/** Check if a card name is a bounce land */
export function isBounceLand(cardName: string): boolean {
  return BOUNCE_LANDS.has((cardName || "").toLowerCase().trim());
}

// ============================================================================
// ETB Pattern Detection
// ============================================================================

/**
 * Detect scry on ETB from oracle text.
 * Returns the scry amount if the land/permanent has "When ~ enters the battlefield, scry X"
 * 
 * This handles Temple of Malice and all other scry lands automatically.
 * Pattern: "When ~ enters the battlefield, scry X" or "enters the battlefield, scry X"
 */
export function detectScryOnETB(oracleText: string): number | null {
  const lowerText = (oracleText || "").toLowerCase();
  
  // Check for scry on ETB patterns
  // "When ~ enters the battlefield, scry 1" (Temples)
  // "enters the battlefield, scry 2" (some cards)
  const scryPatterns = [
    /when\s+(?:~|this\s+\w+)\s+enters\s+(?:the\s+battlefield)?,?\s*scry\s+(\d+)/i,
    /enters\s+(?:the\s+battlefield)?,?\s*scry\s+(\d+)/i,
    // Also check for ", scry X." pattern at end of ETB effect
    /enters\s+(?:the\s+battlefield)[^.]*,\s*scry\s+(\d+)/i,
  ];
  
  for (const pattern of scryPatterns) {
    const match = lowerText.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  
  return null;
}

/**
 * Check if a land has "sacrifice unless you pay" ETB trigger
 * Returns the mana cost to pay, or null if not applicable
 * 
 * This detection is purely oracle-text-based, no hardcoded card names.
 * Pattern: "When ~ enters the battlefield, sacrifice it unless you pay {X}"
 */
export function detectSacrificeUnlessPayETB(cardName: string, oracleText: string): string | null {
  const lowerText = (oracleText || "").toLowerCase();
  
  // Check oracle text for the "sacrifice unless you pay" pattern
  // This handles Transguild Promenade, Gateway Plaza, Rupture Spire, and any future cards
  const patterns = [
    // "When ~ enters the battlefield, sacrifice it unless you pay {1}"
    /when\s+(?:~|this\s+\w+)\s+enters\s+(?:the\s+battlefield)?,?\s*sacrifice\s+(?:~|it|this\s+\w+)\s+unless\s+you\s+pay\s+(\{[^}]+\})/i,
    // "sacrifice ~ unless you pay {1}" (without the "when enters" prefix)
    /sacrifice\s+(?:~|it|this\s+\w+)\s+unless\s+you\s+pay\s+(\{[^}]+\})/i,
  ];
  
  for (const pattern of patterns) {
    const match = lowerText.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Check if a land should always enter tapped based on oracle text patterns.
 * This detects common ETB-tapped land patterns like:
 * - "enters the battlefield tapped"
 * - "comes into play tapped"
 * - Conditional ETB tapped (unless you control X, etc.)
 * 
 * Returns:
 * - 'always': Always enters tapped (e.g., Temples, Gain lands, Guildgates)
 * - 'conditional': Has conditional entry (shock lands handled separately)
 * - 'never': Normal entry
 */
export function detectETBTappedPattern(oracleText: string): 'always' | 'conditional' | 'never' {
  const text = (oracleText || '').toLowerCase();
  
  // Check for "enters the battlefield tapped" or "comes into play tapped"
  const etbTappedMatch = 
    text.includes('enters the battlefield tapped') ||
    text.includes('enters tapped') ||
    text.includes('comes into play tapped');
  
  if (!etbTappedMatch) {
    return 'never';
  }
  
  // Find the sentence containing "enters the battlefield tapped" to check conditionals
  // IMPORTANT: Only check for conditionals in the ETB sentence, not the entire oracle text
  // For example, Emeria, the Sky Ruin has "enters the battlefield tapped." as one sentence
  // and "if you control seven or more Plains" in a different (upkeep trigger) sentence.
  // We should NOT consider it conditional just because another sentence has "if you control".
  const sentences = text.split(/[.!]/);
  const etbSentence = sentences.find(s => 
    s.includes('enters the battlefield tapped') ||
    s.includes('enters tapped') ||
    s.includes('comes into play tapped')
  ) || '';
  
  // Check for conditional patterns ONLY in the ETB sentence
  const conditionalPatterns = [
    'unless you',           // "unless you control" / "unless you pay"
    'you may pay',          // Shock lands
    'if you control',       // Checklands
    'if you don\'t',        // Various conditionals
    'if an opponent',       // Fast lands (sort of)
  ];
  
  for (const pattern of conditionalPatterns) {
    if (etbSentence.includes(pattern)) {
      return 'conditional';
    }
  }
  
  // Unconditional ETB tapped
  return 'always';
}

/**
 * Result of evaluating conditional land ETB (Enter the Battlefield) effects.
 * 
 * Used to determine whether a land should enter tapped and what prompts
 * may be needed from the player (e.g., reveal a card from hand).
 * 
 * @property shouldEnterTapped - Whether the land should enter tapped based on current board state
 * @property reason - Human-readable explanation of why the land enters tapped or untapped
 * @property requiresRevealPrompt - Whether the player needs to be prompted to reveal a card
 * @property revealTypes - Land types that can be revealed to enter untapped (e.g., ['forest', 'island'])
 * @property canReveal - Whether the player has a matching card in hand they could reveal
 */
export interface ConditionalLandETBResult {
  shouldEnterTapped: boolean;
  reason: string;
  requiresRevealPrompt?: boolean;
  revealTypes?: string[];
  canReveal?: boolean;
}

/**
 * Evaluate conditional ETB tapped lands and determine if they should enter tapped.
 * Returns the result and any required prompts for the player.
 * 
 * Handles:
 * - Slow lands: "unless you control two or more other lands" (Stormcarved Coast)
 * - Fast lands: "unless you control two or fewer other lands"
 * - Check lands: "unless you control a [type]" (Castle Locthwain, Dragonskull Summit)
 * - Reveal lands: "you may reveal a [type] card from your hand" (Furycalm Snarl)
 * 
 * @param oracleText - The oracle text of the land
 * @param controlledLandCount - Number of OTHER lands the player controls (not counting this one)
 * @param controlledLandTypes - Array of land subtypes the player controls
 * @param cardsInHand - Player's hand (for reveal land checks)
 * @param basicLandCount - Number of BASIC lands the player controls (for battle lands)
 * @returns Object with shouldEnterTapped, reason, and optional prompt for reveal lands
 */
export function evaluateConditionalLandETB(
  oracleText: string,
  controlledLandCount: number,
  controlledLandTypes: string[],
  cardsInHand?: any[],
  basicLandCount?: number
): ConditionalLandETBResult {
  const text = (oracleText || '').toLowerCase();
  
  // BFZ Tango/Battle lands (Cinder Glade, Canopy Vista, etc.)
  // "enters the battlefield tapped unless you control two or more basic lands"
  const battleLandMatch = text.match(/enters the battlefield tapped unless you control two or more basic lands/i);
  if (battleLandMatch) {
    // Use the provided basicLandCount if available, otherwise use fallback
    // NOTE: Using controlledLandTypes.length as fallback is INCORRECT for dual lands
    // (e.g., Blood Crypt with Swamp+Mountain types would count as 2 instead of 1)
    // Calling code should always provide basicLandCount parameter
    let actualBasicLandCount: number;
    if (basicLandCount !== undefined) {
      actualBasicLandCount = basicLandCount;
    } else {
      // Fallback: This is buggy for dual lands but kept for backward compatibility
      // Count unique basic land types - still wrong but better than counting all types
      const basicTypes = new Set<string>();
      const knownBasicTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
      for (const type of controlledLandTypes) {
        if (knownBasicTypes.includes(type.toLowerCase())) {
          basicTypes.add(type.toLowerCase());
        }
      }
      actualBasicLandCount = basicTypes.size;
      console.warn('[evaluateConditionalLandETB] Battle land check using fallback - may be incorrect for dual lands');
    }
    
    const shouldTap = actualBasicLandCount < 2;
    return {
      shouldEnterTapped: shouldTap,
      reason: shouldTap 
        ? `Enters tapped (you control only ${actualBasicLandCount} basic land${actualBasicLandCount !== 1 ? 's' : ''})` 
        : `Enters untapped (you control ${actualBasicLandCount} basic lands)`,
    };
  }
  
  // Slow lands (Stormcarved Coast, Haunted Ridge, etc.)
  // "enters the battlefield tapped unless you control two or more other lands"
  const slowLandMatch = text.match(/enters the battlefield tapped unless you control two or more other lands/i);
  if (slowLandMatch) {
    const shouldTap = controlledLandCount < 2;
    return {
      shouldEnterTapped: shouldTap,
      reason: shouldTap 
        ? `Enters tapped (you control only ${controlledLandCount} other land${controlledLandCount !== 1 ? 's' : ''})` 
        : `Enters untapped (you control ${controlledLandCount} other lands)`,
    };
  }
  
  // AFR Creature Lands / Lair lands (Den of the Bugbear, Hive of the Eye Tyrant, Lair of the Hydra, etc.)
  // Oracle text: "If you control two or more other lands, this land enters tapped."
  // This is the INVERSE of slow lands - enters tapped if you have 2+ other lands
  // Note: The oracle text says "this land enters tapped" NOT "enters the battlefield tapped"
  const lairLandMatch = text.match(/if you control two or more other lands,.*(?:this land )?enters(?: the battlefield)? tapped/i);
  if (lairLandMatch) {
    const shouldTap = controlledLandCount >= 2;
    return {
      shouldEnterTapped: shouldTap,
      reason: shouldTap 
        ? `Enters tapped (you control ${controlledLandCount} other lands)` 
        : `Enters untapped (you control only ${controlledLandCount} other land${controlledLandCount !== 1 ? 's' : ''})`,
    };
  }
  
  // Fast lands (Blooming Marsh, Botanical Sanctum, etc.)
  // "enters the battlefield tapped unless you control two or fewer other lands"
  const fastLandMatch = text.match(/enters the battlefield tapped unless you control two or fewer other lands/i);
  if (fastLandMatch) {
    const shouldTap = controlledLandCount > 2;
    return {
      shouldEnterTapped: shouldTap,
      reason: shouldTap 
        ? `Enters tapped (you control ${controlledLandCount} other lands)` 
        : `Enters untapped (you control only ${controlledLandCount} other land${controlledLandCount !== 1 ? 's' : ''})`,
    };
  }
  
  // Check lands with single type (Castle Locthwain - Swamp, Castle Garenbrig - Forest, etc.)
  // "enters the battlefield tapped unless you control a [Type]" or "this land enters tapped unless you control a [Type]"
  const singleCheckMatch = text.match(/(?:this land )?enters(?: the battlefield)? tapped unless you control (?:a|an) ([\w]+)/i);
  if (singleCheckMatch && !text.includes(' or ')) {
    const requiredType = singleCheckMatch[1].toLowerCase();
    const hasRequiredType = controlledLandTypes.some(t => t.toLowerCase().includes(requiredType));
    return {
      shouldEnterTapped: !hasRequiredType,
      reason: hasRequiredType 
        ? `Enters untapped (you control a ${requiredType})` 
        : `Enters tapped (no ${requiredType} controlled)`,
    };
  }
  
  // Check lands with "or" condition (Dragonskull Summit - Swamp or Mountain, etc.)
  // "enters the battlefield tapped unless you control a [Type] or [Type]" or "this land enters tapped unless you control a [Type] or [Type]"
  const dualCheckMatch = text.match(/(?:this land )?enters(?: the battlefield)? tapped unless you control (?:a|an) ([\w]+) or ([\w]+)/i);
  if (dualCheckMatch) {
    const type1 = dualCheckMatch[1].toLowerCase();
    const type2 = dualCheckMatch[2].toLowerCase();
    const hasEitherType = controlledLandTypes.some(t => {
      const lower = t.toLowerCase();
      return lower.includes(type1) || lower.includes(type2);
    });
    return {
      shouldEnterTapped: !hasEitherType,
      reason: hasEitherType 
        ? `Enters untapped (you control a ${type1} or ${type2})` 
        : `Enters tapped (no ${type1} or ${type2} controlled)`,
    };
  }
  
  // Reveal lands (Furycalm Snarl, Vineglimmer Snarl, etc.)
  // "you may reveal a [Type] or [Type] card from your hand. If you don't, ~ enters the battlefield tapped"
  const revealMatch = text.match(/you may reveal (?:a|an) ([\w]+) or ([\w]+) card from your hand/i);
  if (revealMatch) {
    const type1 = revealMatch[1].toLowerCase();
    const type2 = revealMatch[2].toLowerCase();
    const revealTypes = [type1, type2];
    
    // Check if player has any matching cards in hand
    let canReveal = false;
    if (cardsInHand && cardsInHand.length > 0) {
      canReveal = cardsInHand.some(card => {
        const cardTypeLine = (card.type_line || '').toLowerCase();
        return revealTypes.some(rtype => cardTypeLine.includes(rtype));
      });
    }
    
    return {
      shouldEnterTapped: true, // Default to tapped, player chooses
      reason: canReveal 
        ? `May reveal a ${type1} or ${type2} to enter untapped`
        : `Enters tapped (no ${type1} or ${type2} in hand to reveal)`,
      requiresRevealPrompt: canReveal,
      revealTypes,
      canReveal,
    };
  }
  
  // Reveal lands with single type (some old lands)
  const singleRevealMatch = text.match(/you may reveal (?:a|an) ([\w]+) card from your hand/i);
  if (singleRevealMatch) {
    const requiredType = singleRevealMatch[1].toLowerCase();
    const revealTypes = [requiredType];
    
    let canReveal = false;
    if (cardsInHand && cardsInHand.length > 0) {
      canReveal = cardsInHand.some(card => {
        const cardTypeLine = (card.type_line || '').toLowerCase();
        return cardTypeLine.includes(requiredType);
      });
    }
    
    return {
      shouldEnterTapped: true,
      reason: canReveal 
        ? `May reveal a ${requiredType} to enter untapped`
        : `Enters tapped (no ${requiredType} in hand to reveal)`,
      requiresRevealPrompt: canReveal,
      revealTypes,
      canReveal,
    };
  }
  
  // Default - shouldn't reach here if detectETBTappedPattern was used first
  return {
    shouldEnterTapped: false,
    reason: 'Normal entry',
  };
}

/**
 * Extract land subtypes from a type line
 * Returns an array of land subtypes (Plains, Island, Swamp, Mountain, Forest, etc.)
 */
export function getLandSubtypes(typeLine: string): string[] {
  const subtypes: string[] = [];
  const lowerTypeLine = (typeLine || '').toLowerCase();
  
  // Basic land types
  const basicTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
  for (const basicType of basicTypes) {
    if (lowerTypeLine.includes(basicType)) {
      subtypes.push(basicType.charAt(0).toUpperCase() + basicType.slice(1));
    }
  }
  
  // Additional land subtypes (non-basic)
  const additionalTypes = ['gate', 'desert', 'lair', 'locus', 'mine', 'power-plant', 'tower', 'urza\'s'];
  for (const addType of additionalTypes) {
    if (lowerTypeLine.includes(addType)) {
      subtypes.push(addType.charAt(0).toUpperCase() + addType.slice(1));
    }
  }
  
  return subtypes;
}
